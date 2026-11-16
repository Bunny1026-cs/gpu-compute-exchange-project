/**
 * test/workerLifecycle.test.js
 * P1-2: worker lifecycle transitions are conditional, so duplicate or
 * concurrent requests cannot both succeed or repeat side effects.
 * P2-3: worker API key check (constant-time) keeps its behaviour.
 */

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { makeModel } = require("./helpers/inMemoryModels");
const { loadWithStubs, quiet } = require("./helpers/loadWithStubs");
const { mockReq, mockRes } = require("./helpers/httpMocks");

const JOB_STATUS = { QUEUED: "QUEUED", ASSIGNED: "ASSIGNED", RUNNING: "RUNNING",
  RESULT_UPLOADED: "RESULT_UPLOADED", COMPLETED: "COMPLETED", FAILED: "FAILED", CANCELLED: "CANCELLED" };
const GPU_STATUS = { ACTIVE: "ACTIVE", INACTIVE: "INACTIVE", BUSY: "BUSY" };

function setup(jobStatus, { chain = false } = {}) {
  const jobs = [{ _id: "j1", status: jobStatus, gpuId: "g1", resultHash: jobStatus === "RESULT_UPLOADED" ? "0x" + "11".repeat(32) : null,
                  blockchainJobId: chain ? "0x" + "0".repeat(63) + "1" : null, blockchainTxHash: null }];
  const gpus = [{ _id: "g1", status: GPU_STATUS.BUSY, availability: false }];
  const Job = makeModel(jobs); Job.JOB_STATUS = JOB_STATUS;
  const GPU = makeModel(gpus); GPU.GPU_STATUS = GPU_STATUS;
  const Transaction = makeModel([]);
  Transaction.TX_TYPE = { PAYMENT_RELEASE: "PAYMENT_RELEASE", REFUND: "REFUND" };
  Transaction.TX_STATUS = { CONFIRMED: "CONFIRMED" };
  const chainCalls = [];
  const rec = (n) => async () => { chainCalls.push(n); await new Promise((r) => setTimeout(r, 5)); return { txHash: "0x" + n }; };
  const ctl = loadWithStubs("controllers/workerController.js", {
    "models/Job.js": Job, "models/GPU.js": GPU, "models/Transaction.js": Transaction,
    "blockchain/blockchainService.js": { isAvailable: () => chain,
      verifyResult: rec("verify"), releasePayment: rec("release"), refund: rec("refund") },
    "services/ipfsService.js": { isAvailable: () => true, getMode: () => "mock",
      isValidCid: () => true, uploadJSON: async () => ({ cid: "QmMock" + "a".repeat(44) }) },
  });
  return { ctl, jobs, gpus, GPU, chainCalls };
}

async function concurrently(fn, n, reqInit) {
  return quiet(() => Promise.all(Array.from({ length: n }, async () => {
    const res = mockRes();
    await fn(mockReq(reqInit), res);
    return res;
  })));
}
const codes = (rs) => rs.map((r) => r.statusCode).sort();

test("concurrent start: exactly one succeeds, the rest get 400 with the original message", async () => {
  const s = setup(JOB_STATUS.ASSIGNED);
  const rs = await concurrently(s.ctl.startJob, 5, { params: { id: "j1" } });
  assert.deepEqual(codes(rs), [200, 400, 400, 400, 400]);
  assert.equal(s.jobs[0].status, JOB_STATUS.RUNNING);
  assert.match(rs.find((r) => r.statusCode === 400).body.message, /^Cannot start job in RUNNING status\. Must be ASSIGNED\.$/);
});

test("start on a missing job still returns 404", async () => {
  const s = setup(JOB_STATUS.ASSIGNED);
  const [r] = await concurrently(s.ctl.startJob, 1, { params: { id: "nope" } });
  assert.equal(r.statusCode, 404);
});

test("concurrent result submissions: one accepted, the first accepted hash is not overwritten", async () => {
  const s = setup(JOB_STATUS.RUNNING);
  const rs = await quiet(() => Promise.all(["aa", "bb", "cc"].map(async (h) => {
    const res = mockRes();
    await s.ctl.submitResult(mockReq({ params: { id: "j1" }, body: { resultHash: h.repeat(32), resultData: { h } } }), res);
    return { res, h };
  })));
  const ok = rs.filter((x) => x.res.statusCode === 200);
  assert.equal(ok.length, 1);
  assert.equal(s.jobs[0].status, JOB_STATUS.RESULT_UPLOADED);
  assert.equal(s.jobs[0].resultHash, ok[0].h.repeat(32));
});

test("concurrent complete (chain available): one 200; verify and release are each called once; GPU released", async () => {
  const s = setup(JOB_STATUS.RESULT_UPLOADED, { chain: true });
  const rs = await concurrently(s.ctl.completeJob, 4, { params: { id: "j1" } });
  assert.deepEqual(codes(rs), [200, 400, 400, 400]);
  assert.deepEqual(s.chainCalls, ["verify", "release"]);
  assert.equal(s.jobs[0].status, JOB_STATUS.COMPLETED);
  assert.equal(s.jobs[0].blockchainTxHash, "0xrelease");
  assert.equal(s.gpus[0].status, GPU_STATUS.ACTIVE);
});

test("complete without chain keeps the original behaviour (COMPLETED, GPU released)", async () => {
  const s = setup(JOB_STATUS.RESULT_UPLOADED);
  const [r] = await concurrently(s.ctl.completeJob, 1, { params: { id: "j1" } });
  assert.equal(r.statusCode, 200);
  assert.equal(r.body.data.status, JOB_STATUS.COMPLETED);
  assert.equal(s.jobs[0].status, JOB_STATUS.COMPLETED);
  assert.ok(s.jobs[0].completedAt);
  assert.equal(s.gpus[0].status, GPU_STATUS.ACTIVE);
  assert.deepEqual(s.chainCalls, []);
});

test("concurrent fail: one 200, refund attempted once, GPU released once", async () => {
  const s = setup(JOB_STATUS.RUNNING, { chain: true });
  const rs = await concurrently(s.ctl.failJob, 3, { params: { id: "j1" }, body: { reason: "x" } });
  assert.deepEqual(codes(rs), [200, 400, 400]);
  assert.deepEqual(s.chainCalls, ["refund"]);
  assert.equal(s.jobs[0].status, JOB_STATUS.FAILED);
  assert.equal(s.gpus[0].status, GPU_STATUS.ACTIVE);
  assert.equal(s.GPU.calls.filter((c) => c.op === "findOneAndUpdate").length, 1);
});

test("fail on a COMPLETED job is rejected and does not touch the GPU", async () => {
  const s = setup(JOB_STATUS.COMPLETED);
  s.gpus[0].status = GPU_STATUS.ACTIVE;
  const [r] = await concurrently(s.ctl.failJob, 1, { params: { id: "j1" }, body: {} });
  assert.equal(r.statusCode, 400);
  assert.equal(r.body.message, "Cannot fail job in COMPLETED status. Must be RUNNING or ASSIGNED.");
  assert.equal(s.GPU.calls.length, 0);
});

test("GPU release never overrides a non-BUSY GPU (e.g. provider set INACTIVE)", async () => {
  const s = setup(JOB_STATUS.RUNNING);
  s.gpus[0].status = GPU_STATUS.INACTIVE;
  await concurrently(s.ctl.failJob, 1, { params: { id: "j1" }, body: {} });
  assert.equal(s.gpus[0].status, GPU_STATUS.INACTIVE);
});

test("worker API key: missing/wrong → 401, correct → next(), unset → 503", async () => {
  const s = setup(JOB_STATUS.ASSIGNED);
  const saved = process.env.WORKER_API_KEY;
  try {
    process.env.WORKER_API_KEY = "correct-key";
    for (const [hdr, expect] of [[undefined, 401], ["wrong", 401], ["correct-ke", 401], ["correct-key-", 401]]) {
      const res = mockRes(); let called = false;
      s.ctl.authenticateWorker(mockReq({ headers: hdr === undefined ? {} : { "x-worker-api-key": hdr } }), res, () => { called = true; });
      assert.equal(called, false, String(hdr)); assert.equal(res.statusCode, expect, String(hdr));
    }
    let called = false;
    s.ctl.authenticateWorker(mockReq({ headers: { "x-worker-api-key": "correct-key" } }), mockRes(), () => { called = true; });
    assert.equal(called, true);
    delete process.env.WORKER_API_KEY;
    const res = mockRes();
    await quiet(() => s.ctl.authenticateWorker(mockReq({ headers: { "x-worker-api-key": "x" } }), res, () => {}));
    assert.equal(res.statusCode, 503);
  } finally {
    if (saved === undefined) delete process.env.WORKER_API_KEY; else process.env.WORKER_API_KEY = saved;
  }
});
