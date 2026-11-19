"use strict";
// Independently compare the collector's observations, MongoDB and live Hardhat.
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const mongoose = require("../backend/node_modules/mongoose");
const { ethers } = require("../backend/node_modules/ethers");
const { ESCROW_ABI } = require("../backend/blockchain/contractAbi");

async function main() {
  const input = process.argv[2];
  const report = JSON.parse(await fs.readFile(input));
  const samples = report.samples || [{ jobId: report.job, resultHash: report.metadata.sha256, paymentWei: report.paid }];
  assert.ok(samples.length);
  const config = require("../backend/node_modules/dotenv").parse(await fs.readFile("runtime/backend.env"));
  const rpc = new ethers.JsonRpcProvider(process.env.BLOCKCHAIN_RPC_URL || config.BLOCKCHAIN_RPC_URL);
  try {
    await mongoose.connect(process.env.MONGODB_URI || config.MONGODB_URI);
    const db = mongoose.connection.db;
    const metadata = await rpc.send("hardhat_metadata", []);
    assert.equal(Number(metadata.chainId), 31337);
    const contract = new ethers.Contract(config.ESCROW_CONTRACT_ADDRESS, ESCROW_ABI, rpc);
    const checks = [];
    for (const { jobId, resultHash, paymentWei } of samples) {
      const job = await db.collection("jobs").findOne({ _id: new mongoose.Types.ObjectId(jobId) });
      assert.equal(job.status, "COMPLETED");
      assert.equal(job.chainInstance, metadata.instanceId + ":" + contract.target.toLowerCase());
      assert.equal(job.resultHash, resultHash);
      assert.equal(job.paymentWei, paymentWei);
      const state = await contract.getJob(job.blockchainJobId);
      assert.equal(Number(state.status), 6);
      assert.equal(state.paymentReleased, true);
      assert.equal(state.resultHash, "0x" + resultHash);
      const operator = await contract.operator();
      const senders = { JobRegistered: state.consumer, FundsDeposited: state.consumer, JobAssigned: operator,
        ResultSubmitted: state.provider, ResultVerified: operator, PaymentReleased: operator };
      assert.equal(new Set([state.consumer, state.provider, operator]).size, 3);
      assert.equal(state.provider.toLowerCase(), job.providerWallet.toLowerCase());
      for (const [event, sender] of Object.entries(senders)) {
        const receipts = job.receipts.filter(r => r.action === event);
        assert.equal(receipts.length, 1);
        const receipt = await rpc.getTransactionReceipt(receipts[0].txHash);
        assert.equal(receipt.status, 1);
        assert.equal(receipt.from, sender);
        assert.equal(receipt.to.toLowerCase(), contract.target.toLowerCase());
        assert.equal(receipt.gasUsed.toString(), receipts[0].gasUsed);
        const log = receipt.logs.filter(l => l.address.toLowerCase() === contract.target.toLowerCase())
          .map(l => contract.interface.parseLog(l)).find(l => l?.name === event && l.args.jobId === job.blockchainJobId);
        assert.ok(log, event + " log missing");
        if (event === "PaymentReleased") assert.equal(log.args.amount.toString(), paymentWei);
      }
      const slot = await db.collection("gpus").findOne({ _id: job.gpuId });
      assert.notEqual(String(slot.activeJob), jobId);
      checks.push({ jobId, blockchainJobId: job.blockchainJobId, provider: state.provider, consumer: state.consumer,
        operator, resultHash, paymentWei, verifiedReceiptEvents: Object.keys(senders), reservationReleased: true });
    }
    for (const id of [report.timeoutJob, report.disputeJob].filter(Boolean)) {
      const job = await db.collection("jobs").findOne({ _id: new mongoose.Types.ObjectId(id) });
      assert.equal(job.status, "REFUNDED");
      const state = await contract.getJob(job.blockchainJobId);
      assert.equal(Number(state.status), 7);
      assert.equal(state.paymentReleased, false);
      const refunds = await contract.queryFilter(contract.filters.RefundIssued(job.blockchainJobId));
      assert.equal(refunds.length, 1);
      assert.equal(refunds[0].args.amount.toString(), job.escrowAmountWei);
      assert.equal(refunds[0].args.consumer, state.consumer);
      assert.equal(job.receipts.find(r => r.action === "RefundIssued").txHash, refunds[0].transactionHash);
      const receipt = await rpc.getTransactionReceipt(refunds[0].transactionHash);
      assert.equal(receipt.from, await contract.operator());
      assert.equal(receipt.status, 1);
      assert.equal((await contract.queryFilter(contract.filters.PaymentReleased(job.blockchainJobId))).length, 0);
      if (id === report.disputeJob) assert.deepEqual(job.reviewHistory.map(r => r.decision), ["issue", "refund"]);
      const slot = await db.collection("gpus").findOne({ _id: job.gpuId });
      assert.notEqual(String(slot.activeJob), id);
      checks.push({ jobId: id, refundWei: job.escrowAmountWei, refundReceipt: receipt.hash,
        reviewHistory: job.reviewHistory, reservationReleased: true });
    }
    await fs.writeFile(path.join(path.dirname(input), "settlement-checks.json"), JSON.stringify(checks, null, 2));
    console.log("MongoDB, escrow events, wallet identities and reservation release matched for", checks.length, "jobs");
  } finally { await mongoose.disconnect(); rpc.destroy(); }
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
