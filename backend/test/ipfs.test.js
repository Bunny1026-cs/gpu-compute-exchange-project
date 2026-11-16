/**
 * test/ipfs.test.js
 * P0-2: CID validation and path containment in services/ipfsService.js,
 * and rejection of worker-supplied / invalid CIDs in the controllers.
 */

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const { loadWithStubs, quiet, BACKEND } = require("./helpers/loadWithStubs");
const { makeModel } = require("./helpers/inMemoryModels");
const { mockReq, mockRes } = require("./helpers/httpMocks");

const MOCK_DIR = path.join(BACKEND, ".ipfs-mock");
const CANARY = path.join(BACKEND, ".p0-2-canary.env");

async function freshMockService() {
  delete process.env.IPFS_API_URL;
  const svc = loadWithStubs("services/ipfsService.js");
  await quiet(() => svc.initialize());
  return svc;
}

test("valid mock CID: upload then retrieve round-trips", async () => {
  const svc = await freshMockService();
  const { cid } = await quiet(() => svc.uploadJSON({ hello: "world", t: Date.now() }));
  try {
    assert.match(cid, /^QmMock[0-9a-f]{44}$/);
    assert.equal(svc.isValidCid(cid), true);
    const got = await svc.retrieve(cid);
    assert.equal(JSON.parse(got.content).hello, "world");
  } finally {
    fs.rmSync(path.join(MOCK_DIR, cid), { force: true });
    fs.rmSync(path.join(MOCK_DIR, `${cid}.meta.json`), { force: true });
  }
});

test("path traversal identifiers are rejected and never read", async () => {
  fs.writeFileSync(CANARY, "SECRET=must-not-leak\n");
  try {
    const svc = await freshMockService();
    for (const bad of ["../.p0-2-canary.env", "..%2F.p0-2-canary.env", "../../etc/passwd",
                       "/etc/passwd", "QmMock/../../.p0-2-canary.env", "..\\.p0-2-canary.env"]) {
      await assert.rejects(svc.retrieve(bad), (e) => e.name === "InvalidCidError" && e.statusCode === 400, bad);
    }
  } finally {
    fs.rmSync(CANARY, { force: true });
  }
});

test("malformed identifiers are invalid in mock mode", async () => {
  const svc = await freshMockService();
  for (const bad of ["", "abc", "QmMock" + "g".repeat(44), "QmMock" + "a".repeat(43),
                     "QmMock" + "a".repeat(45), "QmMOCK" + "a".repeat(44), null, undefined, 42, {}]) {
    assert.equal(svc.isValidCid(bad), false, String(bad));
  }
});

test("real mode accepts CIDv0 / base32 CIDv1 syntax and rejects traversal", async () => {
  const svc = await freshMockService();
  svc.mode = "real";                                  // syntax check only; no network used
  const b58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
  const v0 = "Qm" + Array.from({ length: 44 }, (_, i) => b58[(i * 7) % b58.length]).join("");
  const v1 = "b" + "a".repeat(58);
  assert.equal(svc.isValidCid(v0), true);
  assert.equal(svc.isValidCid(v1), true);
  assert.equal(svc.isValidCid("../.env"), false);
  assert.equal(svc.isValidCid("Qm0OIl" + "a".repeat(40)), false, "0, O, I, l are not base58");
  await assert.rejects(svc.retrieve("../.env"), { name: "InvalidCidError" });
});

// ── Controllers ────────────────────────────────────────────────────────
function workerControllerWith(jobs) {
  const Job = makeModel(jobs);
  Job.JOB_STATUS = { ASSIGNED: "ASSIGNED", RUNNING: "RUNNING", RESULT_UPLOADED: "RESULT_UPLOADED",
                     COMPLETED: "COMPLETED", FAILED: "FAILED" };
  const ipfs = {
    isAvailable: () => true, getMode: () => "mock",
    isValidCid: (c) => typeof c === "string" && /^QmMock[0-9a-f]{44}$/.test(c),
    uploadJSON: async () => ({ cid: "QmMock" + "a".repeat(44) }),
    retrieve: async () => { throw new Error("retrieve must not be called"); },
  };
  const ctl = loadWithStubs("controllers/workerController.js", {
    "models/Job.js": Job, "models/GPU.js": Object.assign(makeModel([]), { GPU_STATUS: {} }),
    "models/Transaction.js": Object.assign(makeModel([]), { TX_TYPE: {}, TX_STATUS: {} }),
    "blockchain/blockchainService.js": { isAvailable: () => false },
    "services/ipfsService.js": ipfs,
  });
  return { ctl, jobs };
}

test("worker submitResult rejects a worker-supplied ipfsCid with 400 and leaves the job unchanged", async () => {
  const { ctl, jobs } = workerControllerWith([{ _id: "j1", status: "RUNNING", ipfsCid: null }]);
  const res = mockRes();
  await quiet(() => ctl.submitResult(mockReq({ params: { id: "j1" },
    body: { resultHash: "ab".repeat(32), ipfsCid: "../.env" } }), res));
  assert.equal(res.statusCode, 400);
  assert.equal(jobs[0].status, "RUNNING");
  assert.equal(jobs[0].ipfsCid, null);
});

test("worker submitResult without ipfsCid stores the backend-assigned CID", async () => {
  const { ctl, jobs } = workerControllerWith([{ _id: "j1", status: "RUNNING", ipfsCid: null }]);
  const res = mockRes();
  await quiet(() => ctl.submitResult(mockReq({ params: { id: "j1" },
    body: { resultHash: "ab".repeat(32), resultData: { ok: true } } }), res));
  assert.equal(res.statusCode, 200);
  assert.equal(jobs[0].status, "RESULT_UPLOADED");
  assert.equal(jobs[0].ipfsCid, "QmMock" + "a".repeat(44));
});

test("worker getIPFSContent rejects an invalid CID with 400 before any storage access", async () => {
  const { ctl } = workerControllerWith([]);
  const res = mockRes();
  await quiet(() => ctl.getIPFSContent(mockReq({ params: { cid: "../.env" } }), res));
  assert.equal(res.statusCode, 400);
});

test("job result endpoint does not read storage for an invalid stored CID", async () => {
  const Job = makeModel([{ _id: "j1", consumerId: "c1", status: "RESULT_UPLOADED", gpuId: null,
                           resultHash: "x", ipfsCid: "../.env", completedAt: null }]);
  Job.JOB_STATUS = {};
  let retrieveCalled = false;
  const ctl = loadWithStubs("controllers/jobController.js", {
    "models/Job.js": Job, "models/GPU.js": makeModel([]),
    "services/ipfsService.js": {
      isAvailable: () => true,
      isValidCid: () => false,
      retrieve: async () => { retrieveCalled = true; return { content: "SECRET" }; },
    },
  });
  const res = mockRes();
  await quiet(() => ctl.getJobResult(mockReq({ params: { id: "j1" }, user: { _id: "c1", role: "CONSUMER" } }), res));
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.data.result, null);
  assert.equal(retrieveCalled, false);
});
