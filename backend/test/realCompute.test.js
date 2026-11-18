"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const compute = require("../services/realCompute");
const Job = require("../models/Job");
const bc = require("../blockchain/blockchainService");
const chain = require("../services/realChain");
const storage = require("../services/artifactStorage");

test("Kubo storage requires a round trip of the exact binary artifact", async (t) => {
  const bytes = Buffer.from([147, 0, 255, 67]);
  const cid = "bafy" + "a".repeat(55);
  const previous = process.env.IPFS_API_URL;
  process.env.IPFS_API_URL = "http://127.0.0.1:5001";
  t.after(() => {
    if (previous === undefined) delete process.env.IPFS_API_URL;
    else process.env.IPFS_API_URL = previous;
  });
  let returned = bytes;
  t.mock.method(globalThis, "fetch", async (url, request) => {
    assert.equal(request.method, "POST");
    if (url.includes("/add?")) {
      assert.deepEqual(Buffer.from(await request.body.get("file").arrayBuffer()), bytes);
      return Response.json({ Hash: cid });
    }
    assert.ok(url.endsWith("/cat?arg=" + cid));
    return new Response(returned);
  });
  assert.equal(await storage.pinVerified(bytes), cid);
  assert.deepEqual(await storage.readVerified({ ipfsCid: cid, resultHash: storage.hash(bytes) }), bytes);
  returned = Buffer.from([1]);
  assert.equal(await storage.pinVerified(bytes), null);
  const fs = require("node:fs/promises");
  t.mock.method(fs, "readFile", async () => bytes);
  assert.deepEqual(await storage.readVerified({ ipfsCid: cid, artifactPath: "local", resultHash: storage.hash(bytes) }), bytes);
  await assert.rejects(storage.readVerified({ artifactPath: "local", resultHash: storage.hash(returned) }), /integrity/);
});

test("real workload allowlist, bounded dimensions and strict GPU requirements", () => {
  const valid = { taskType: "matrix_multiply", input: { size: 32, seed: 1 } };
  assert.equal(compute.specification(valid).spec.size, 32);
  for (const body of [
    { ...valid, taskType: "shell" }, { ...valid, input: { size: 2048 } },
    { ...valid, input: { size: true } }, { ...valid, input: { code: "arbitrary" } },
    { ...valid, requirements: { requiredCudaVersion: "oops" } },
    { ...valid, requirements: { requiredGpuMemory: "NaN" } },
  ]) assert.throws(() => compute.specification(body));
});
test("artifact hash binds exact bytes", () => {
  assert.notEqual(compute.hash(Buffer.from([0, 1])), compute.hash(Buffer.from([1, 0])));
  assert.equal(compute.hash("abc"), "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
});
test("real job status includes funding, settlement and refund checkpoints", () => {
  for (const status of ["AWAITING_FUNDING", "SETTLEMENT_PENDING", "REFUND_PENDING", "REFUNDED"]) assert.equal(Job.JOB_STATUS[status], status);
});
test("immutable workload and exact-string wei schema", () => {
  assert.equal(Job.schema.path("spec").options.immutable, true);
  assert.equal(Job.schema.path("specHash").options.immutable, true);
  assert.equal(Job.schema.path("escrowAmountWei").instance, "String");
  assert.equal(Job.schema.path("paymentWei").instance, "String");
});
test("chain instance reset and nonlocal network fail closed", async () => {
  const original = { provider: bc.provider, available: bc.available, contractAddress: bc.contractAddress };
  try {
    bc.available = true; bc.contractAddress = "0xABC";
    bc.provider = { send: async () => ({ chainId: 31337, instanceId: "new" }) };
    await assert.rejects(chain.check({ chainInstance: "old:0xabc" }), /CHAIN_RESET/);
    assert.equal(await chain.check({ chainInstance: "new:0xabc" }), "new:0xabc");
    bc.provider = { send: async () => ({ chainId: 1, instanceId: "new" }) };
    await assert.rejects(chain.instance(), /Only local Hardhat/);
  } finally { Object.assign(bc, original); }
});

test("chain reset invalidates current payment display and releases only stale reservations", async () => {
  const GPU = require("../models/GPU");
  const original = { instance: chain.instance, find: Job.find, update: Job.updateOne, release: GPU.updateOne };
  const writes = [];
  try {
    chain.instance = async () => "current:contract";
    Job.find = async (filter) => {
      assert.deepEqual(filter.chainInstance.$nin, [null, "current:contract"]);
      return [{ _id: "old-job", gpuId: "slot", chainInstance: "old:contract", status: "COMPLETED" }];
    };
    Job.updateOne = async (filter, update) => { writes.push({ filter, update }); };
    GPU.updateOne = async (filter, update) => {
      assert.deepEqual(filter, { _id: "slot", activeJob: "old-job" });
      assert.equal(update.$set.activeJob, null);
    };
    assert.equal(await compute.invalidatePreviousChain(), 1);
    assert.equal(writes[0].update.$set.status, "FAILED");
    assert.equal(writes[0].update.$unset.paymentWei, 1);
    assert.match(writes[0].update.$set.error, /historical receipts/);
  } finally {
    chain.instance = original.instance; Job.find = original.find;
    Job.updateOne = original.update; GPU.updateOne = original.release;
  }
});

test("settlement RPC failure preserves pending state without marking completed or releasing GPU", async () => {
  const fs = require("fs/promises");
  const GPU = require("../models/GPU");
  const original = { claim: Job.findOneAndUpdate, update: Job.updateOne, read: bc.getJob,
    check: chain.check, events: chain.events, send: chain.send, file: fs.readFile, release: GPU.updateOne };
  const writes = [];
  let released = false;
  const bytes = Buffer.from("actual test artifact bytes");
  const job = { _id: "test-job", gpuId: "test-slot", status: "RESULT_UPLOADED",
    verification: { verified: true }, resultHash: compute.hash(bytes), artifactPath: "test-artifact",
    providerWallet: "0xprovider", blockchainJobId: "test-chain-job" };
  try {
    Job.findOneAndUpdate = () => ({ select: async () => job });
    Job.updateOne = async (_filter, update) => { writes.push(update); };
    bc.getJob = async () => ({ status: 4, resultHash: `0x${job.resultHash}`, provider: job.providerWallet });
    chain.check = async () => "test-instance";
    chain.events = async () => ({});
    chain.send = async () => { throw new Error("RPC unavailable during verification"); };
    fs.readFile = async () => bytes;
    GPU.updateOne = async () => { released = true; };
    await assert.rejects(compute.settle(job._id), /RPC unavailable/);
    assert.ok(writes.some((write) => write.$set?.status === "SETTLEMENT_PENDING"));
    assert.ok(!writes.some((write) => write.$set?.status === "COMPLETED"));
    assert.equal(released, false);
    assert.ok(writes.some((write) => write.$unset?.lockToken === 1));
  } finally {
    Job.findOneAndUpdate = original.claim; Job.updateOne = original.update; bc.getJob = original.read;
    chain.check = original.check; chain.events = original.events; chain.send = original.send;
    fs.readFile = original.file; GPU.updateOne = original.release;
  }
});
