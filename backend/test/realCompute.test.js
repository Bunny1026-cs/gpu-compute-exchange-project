"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const compute = require("../services/realCompute");
const Job = require("../models/Job");
const bc = require("../blockchain/blockchainService");
const chain = require("../services/realChain");

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
