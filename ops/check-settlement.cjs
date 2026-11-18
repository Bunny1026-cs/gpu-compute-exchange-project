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
  const { samples } = JSON.parse(await fs.readFile(input));
  assert.ok(samples.length);
  const config = require("../backend/node_modules/dotenv").parse(await fs.readFile("runtime/backend.env"));
  const rpc = new ethers.JsonRpcProvider(config.BLOCKCHAIN_RPC_URL);
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
    await fs.writeFile(path.join(path.dirname(input), "settlement-checks.json"), JSON.stringify(checks, null, 2));
    console.log("MongoDB, three wallet identities and six on-chain receipt events matched for", checks.length, "jobs");
  } finally { await mongoose.disconnect(); rpc.destroy(); }
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
