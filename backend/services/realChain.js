"use strict";
const { ethers } = require("ethers");
const mongoose = require("mongoose");
const bc = require("../blockchain/blockchainService");
const Job = require("../models/Job");
const { ESCROW_ABI } = require("../blockchain/contractAbi");
const journalSchema = new mongoose.Schema({
  jobId: mongoose.Schema.Types.ObjectId, instance: String, action: String,
  txHash: { type: String, unique: true }, raw: { type: String, select: false },
  status: String, gasUsed: String, blockNumber: Number, amountWei: String,
}, { timestamps: true });
const Journal = mongoose.model("ChainJournal", journalSchema);

async function readReceipt(txHash) {
  const raw = await bc.provider.send("eth_getTransactionReceipt", [txHash]);
  return raw ? { hash: raw.transactionHash, to: raw.to, status: Number(BigInt(raw.status)),
    gasUsed: BigInt(raw.gasUsed), blockNumber: Number(BigInt(raw.blockNumber)) } : null;
}

async function instance() {
  bc._requireAvailable();
  const metadata = await bc.provider.send("hardhat_metadata", []);
  if (Number(metadata.chainId) !== 31337) throw new Error("Only local Hardhat chain 31337 is supported");
  return `${metadata.instanceId}:${bc.contractAddress.toLowerCase()}`;
}
async function check(job) {
  const current = await instance();
  if (job.chainInstance && job.chainInstance !== current) {
    throw new Error("CHAIN_RESET: this job belongs to a different Hardhat instance; create a new job");
  }
  return current;
}
async function receiptRecord(job, receipt, action, amountWei) {
  if (!receipt || receipt.status !== 1 || receipt.to?.toLowerCase() !== bc.contractAddress.toLowerCase()) {
    throw new Error("Successful escrow receipt required");
  }
  const record = { action, txHash: receipt.hash, gasUsed: receipt.gasUsed.toString(),
    blockNumber: receipt.blockNumber, amountWei: amountWei || null };
  await Journal.updateOne({ txHash: receipt.hash }, { $set: {
    ...record, jobId: job._id, instance: job.chainInstance, status: "CONFIRMED",
  } }, { upsert: true });
  await Job.updateOne({ _id: job._id, "receipts.txHash": receipt.hash }, {
    $set: { "receipts.$": record },
  });
  await Job.updateOne({ _id: job._id, "receipts.txHash": { $ne: receipt.hash } }, {
    $push: { receipts: record }, $set: { blockchainTxHash: receipt.hash },
  });
  return record;
}
async function send(job, action, args, consumer = false, value = 0n) {
  await check(job);
  const key = consumer ? process.env.DEMO_CONSUMER_PRIVATE_KEY : process.env.BLOCKCHAIN_PRIVATE_KEY;
  const wallet = new ethers.Wallet(key, bc.provider);
  return bc._serialized(wallet.address, async () => {
    let pending = await Journal.findOne({ jobId: job._id, instance: job.chainInstance, action, status: "PENDING" }).select("+raw");
    if (!pending) {
      const contract = new ethers.Contract(bc.contractAddress, ESCROW_ABI, wallet);
      const request = await contract[action].populateTransaction(...args, { value });
      const populated = await wallet.populateTransaction({ ...request, nonce: await bc._getNonce(wallet.address) });
      const raw = await wallet.signTransaction(populated);
      pending = await Journal.create({ jobId: job._id, instance: job.chainInstance,
        action, txHash: ethers.keccak256(raw), raw, status: "PENDING" });
    }
    let receipt = await readReceipt(pending.txHash);
    if (!receipt) {
      try { await bc.provider.broadcastTransaction(pending.raw); }
      catch (error) {
        if (!await bc.provider.getTransaction(pending.txHash)) throw error;
      }
      // Poll raw receipts: avoid provider block-number/receipt caching when
      // several automined local transactions land within one polling interval.
      for (let attempt = 0; attempt < 60; attempt++) {
        const raw = await bc.provider.send("eth_getTransactionReceipt", [pending.txHash]);
        if (raw) {
          receipt = { hash: raw.transactionHash, to: raw.to, status: Number(BigInt(raw.status)),
            gasUsed: BigInt(raw.gasUsed), blockNumber: Number(BigInt(raw.blockNumber)) };
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, 500));
      }
    }
    if (receipt?.status === 0) {
      await Journal.updateOne({ _id: pending._id }, { $set: { status: "REVERTED" } });
      throw new Error(`${action} reverted`);
    }
    return receiptRecord(job, receipt, action);
  });
}
async function events(job) {
  await check(job);
  const names = ["JobRegistered", "FundsDeposited", "JobAssigned", "ResultSubmitted", "ResultVerified", "PaymentReleased", "RefundIssued"];
  const found = {};
  for (const name of names) {
    const logs = await bc.readContract.queryFilter(bc.readContract.filters[name](job.blockchainJobId), 0, "latest");
    for (const log of logs) {
      const receipt = await readReceipt(log.transactionHash);
      await receiptRecord(job, receipt, name, log.args.amount?.toString());
      found[name] = log.args;
    }
  }
  return found;
}
module.exports = { instance, check, send, events, Journal };
