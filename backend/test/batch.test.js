"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const batch = require("../services/batch");
const compute = require("../services/realCompute");
const GPU = require("../models/GPU");
const Job = require("../models/Job");
const body = { source: "print('fixture')", profile: "pytorch-cuda", outputs: ["metrics.json"], seconds: 100, minVramGiB: 5 };

test("brief scheduler contention retries the claim and executes the operation once", async t => {
  const job = { _id: "busy-job" };
  let attempts = 0;
  const execute = t.mock.fn(async claimed => claimed._id);
  t.mock.method(Job, "findOneAndUpdate", () => ({ select: async () => ++attempts === 1 ? null : job }));
  const release = t.mock.method(Job, "updateOne", async () => ({}));
  assert.equal(await compute.locked(job._id, execute), job._id);
  assert.equal(attempts, 2);
  assert.equal(execute.mock.callCount(), 1);
  assert.equal(release.mock.callCount(), 1);
});

test("bind immutable source, profile and controlled output paths", () => {
  const spec = batch.specification(body);
  assert.equal(spec.scriptHash, compute.hash(body.source));
  assert.equal(spec.image, batch.profiles["pytorch-cuda"]);
  assert.throws(() => batch.specification({ ...body, outputs: ["../invalid"] }));
  assert.throws(() => batch.specification({ ...body, args: [42] }));
});

test("duplicate provider completion acknowledges the signed review without settling escrow", async t => {
  const chain = require("../services/realChain");
  const bc = require("../blockchain/blockchainService");
  const job = { _id: "review-job", taskType: "python_batch", status: "REVIEW",
    providerWallet: "0xprovider", resultHash: compute.hash("output") };
  const state = { status: 4, provider: job.providerWallet, resultHash: "0x" + job.resultHash };
  t.mock.method(Job, "findOneAndUpdate", () => ({ select: async () => job }));
  t.mock.method(Job, "updateOne", async () => ({}));
  t.mock.method(Job, "findById", async () => job);
  t.mock.method(chain, "check", async () => "test-instance");
  t.mock.method(bc, "getJob", async () => state);
  const send = t.mock.method(chain, "send", async () => assert.fail("Unexpected escrow transaction"));
  for (const status of ["REVIEW", "DISPUTED"]) {
    job.status = status;
    assert.equal((await compute.settle(job._id)).status, status);
  }
  state.resultHash = "0x" + compute.hash("different output");
  await assert.rejects(compute.settle(job._id), { statusCode: 409 });
  assert.equal(send.mock.callCount(), 0);
});
test("choose a compatible worker within an exact wei quote", async t => {
  const spec = batch.specification(body);
  const quote = "9007199254740993";
  t.mock.method(GPU, "find", filter => {
    assert.equal(filter.activeJob, null);
    assert.equal(filter.availability, true);
    assert.equal(filter["capabilities.testedImage"], spec.image);
    assert.equal(filter.gpuMemory.$gte, 5);
    assert.deepEqual(filter._id.$nin, ["failed"]);
    return { lean: async () => [{ _id: "high", rateWeiPerMinute: "9007199254740994" }, { _id: "low", rateWeiPerMinute: quote }] };
  });
  const job = { spec, rateWeiPerMinute: quote, rejectedSlots: ["failed"] };
  assert.equal((await batch.candidate(job))._id, "low");
  assert.equal(await batch.candidate({ ...job, rateWeiPerMinute: "9007199254740992" }), undefined);
});
test("reject stale lease before an upload can change the artifact", async t => {
  const job = { gpuId: "device", leaseId: "old", leaseExpiresAt: new Date(0) };
  t.mock.method(Job, "findOneAndUpdate", () => ({ select: async () => job }));
  t.mock.method(Job, "updateOne", async () => ({}));
  await assert.rejects(compute.acceptArtifact("job", { _id: "device" }, "old", Buffer.alloc(0)), /Stale/);
});
test("expired reviews require an operator and repeated decisions do not reopen payment", async t => {
  const reviews = require("../services/reviews");
  const job = { _id: "review", taskType: "python_batch", status: "REVIEW", reviewUntil: new Date(0) };
  t.mock.method(compute, "locked", async (_id, fn) => fn(job));
  t.mock.method(Job, "findById", async () => job);
  const writes = t.mock.method(Job, "updateOne", async (_filter, update) => Object.assign(job, update.$set));
  await assert.rejects(reviews.decide(job._id, "accept"), /closed/);
  await reviews.decide(job._id, "refund", "deadline expired", true);
  assert.equal(job.status, "REFUND_PENDING");
  await reviews.decide(job._id, "refund", "deadline expired", true);
  assert.equal(writes.mock.callCount(), 1);
});
test("reject changed output bytes, undeclared files and oversized bundles", () => {
  const spec = batch.specification(body);
  function bundle(name, bytes, digest = compute.hash(bytes)) {
    return Buffer.from(JSON.stringify([{ name, data: bytes.toString("base64"), sha256: digest }]));
  }
  const bytes = Buffer.from("{}");
  assert.equal(batch.checkBundle(bundle("metrics.json", bytes), spec)[0].bytes, 2);
  assert.throws(() => batch.checkBundle(bundle("metrics.json", bytes, compute.hash("other")), spec), /digest/);
  assert.throws(() => batch.checkBundle(bundle("other.json", bytes), spec), /Unexpected/);
  assert.throws(() => batch.checkBundle(bundle("metrics.json", Buffer.alloc(2097153)), spec), /2 MiB/);
});
