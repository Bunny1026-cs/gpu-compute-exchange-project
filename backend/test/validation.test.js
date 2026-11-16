/**
 * test/validation.test.js
 * P1-1: numeric CUDA comparison, maximumPrice = 0 as a real limit, and
 * rejection of malformed requirements (matcher and API layer).
 */

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { isCompatible, parseCuda, compareCuda } = require("../scheduler/matcher");
const { makeModel } = require("./helpers/inMemoryModels");
const { loadWithStubs, quiet } = require("./helpers/loadWithStubs");
const { mockReq, mockRes } = require("./helpers/httpMocks");

const g = (extra) => ({ _id: "a", availability: true, status: "ACTIVE", gpuMemory: 24,
                        cudaVersion: "12.2", pricePerHour: 100, ...extra });

// ── matcher ─────────────────────────────────────────────────────────
test("CUDA: multi-digit minor versions compare numerically (11.10 > 11.8)", () => {
  assert.equal(isCompatible(g({ cudaVersion: "11.8" }), { requiredCudaVersion: "11.10" }), false);
  assert.equal(isCompatible(g({ cudaVersion: "11.10" }), { requiredCudaVersion: "11.8" }), true);
});
test("CUDA: equal versions with different precision are compatible (12 == 12.0 == 12.0.0)", () => {
  assert.equal(isCompatible(g({ cudaVersion: "12" }), { requiredCudaVersion: "12.0.0" }), true);
  assert.equal(isCompatible(g({ cudaVersion: "12.0" }), { requiredCudaVersion: "12" }), true);
});
test("CUDA: patch level is compared", () => {
  assert.equal(isCompatible(g({ cudaVersion: "12.2.0" }), { requiredCudaVersion: "12.2.1" }), false);
  assert.equal(isCompatible(g({ cudaVersion: "12.2.2" }), { requiredCudaVersion: "12.2.1" }), true);
});
test("CUDA: a malformed requirement matches no GPU", () => {
  assert.equal(isCompatible(g(), { requiredCudaVersion: "abc" }), false);
  assert.equal(isCompatible(g(), { requiredCudaVersion: "12.x" }), false);
});
test("CUDA: a GPU with a malformed version is not matched when CUDA is required", () => {
  assert.equal(isCompatible(g({ cudaVersion: "latest" }), { requiredCudaVersion: "11.0" }), false);
  assert.equal(isCompatible(g({ cudaVersion: "latest" }), {}), true, "no CUDA requirement: unaffected");
});
test("parseCuda / compareCuda", () => {
  assert.deepEqual(parseCuda("12.2"), [12, 2, 0]);
  assert.deepEqual(parseCuda(" 11.10.1 "), [11, 10, 1]);
  assert.equal(parseCuda("12.2.1.4"), null);
  assert.equal(parseCuda(""), null);
  assert.ok(compareCuda(parseCuda("11.10"), parseCuda("11.8")) > 0);
});
test("maximumPrice = 0 is a real limit (free GPUs only)", () => {
  assert.equal(isCompatible(g({ pricePerHour: 100 }), { maximumPrice: 0 }), false);
  assert.equal(isCompatible(g({ pricePerHour: 0 }), { maximumPrice: 0 }), true);
});
test("absent requirement fields (undefined, null, empty string) impose no limit", () => {
  assert.equal(isCompatible(g(), { maximumPrice: "", requiredGpuMemory: null, requiredCudaVersion: undefined }), true);
});
test("malformed memory or price requirement matches no GPU", () => {
  assert.equal(isCompatible(g(), { requiredGpuMemory: "abc" }), false);
  assert.equal(isCompatible(g(), { maximumPrice: "cheap" }), false);
});

// ── createJob validation ────────────────────────────────────────────
function jobControllerWith() {
  const created = [];
  const Job = {
    JOB_STATUS: { CREATED: "CREATED", QUEUED: "QUEUED" },
    async create(doc) {
      const d = { _id: "j1", ...doc };
      d.save = async () => d;
      d.populate = async () => d;
      created.push(d);
      return d;
    },
  };
  const ctl = loadWithStubs("controllers/jobController.js", {
    "models/Job.js": Job, "models/GPU.js": makeModel([]),
    "services/ipfsService.js": { isAvailable: () => false, isValidCid: () => false },
  });
  return { ctl, created };
}
async function createJob(body) {
  const { ctl, created } = jobControllerWith();
  const res = mockRes();
  await quiet(() => ctl.createJob(mockReq({ body, user: { _id: "c1", role: "CONSUMER" } }), res));
  return { res, created };
}

test("createJob rejects malformed requirements with 400 and creates nothing", async () => {
  for (const requirements of [
    { requiredCudaVersion: "abc" }, { requiredCudaVersion: "12.x" },
    { requiredGpuMemory: "lots" }, { maximumPrice: "cheap" },
  ]) {
    const { res, created } = await createJob({ price: 10, requirements });
    assert.equal(res.statusCode, 400, JSON.stringify(requirements));
    assert.equal(created.length, 0);
  }
});
test("createJob rejects a non-numeric price and a non-string taskType", async () => {
  assert.equal((await createJob({ price: "ten" })).res.statusCode, 400);
  assert.equal((await createJob({ price: 10, taskType: { $gt: "" } })).res.statusCode, 400);
});
test("createJob keeps the existing negative-value messages", async () => {
  const r = await createJob({ price: 10, requirements: { maximumPrice: -1 } });
  assert.equal(r.res.statusCode, 400);
  assert.equal(r.res.body.message, "maximumPrice cannot be negative.");
});
test("createJob accepts valid requirements, including maximumPrice 0 and CUDA 11.10", async () => {
  const { res, created } = await createJob({ price: 10, taskType: "inference",
    requirements: { requiredCudaVersion: "11.10", requiredGpuMemory: 16, maximumPrice: 0 } });
  assert.equal(res.statusCode, 201);
  assert.equal(created[0].status, "QUEUED");
  assert.equal(created[0].input.requirements.requiredCudaVersion, "11.10");
});

// ── GPU cudaVersion format ──────────────────────────────────────────
function gpuCtl(gpus) {
  const GPU = makeModel(gpus);
  GPU.GPU_STATUS = { ACTIVE: "ACTIVE", INACTIVE: "INACTIVE", BUSY: "BUSY" };
  return { ctl: loadWithStubs("controllers/gpuController.js", { "models/GPU.js": GPU }), gpus };
}
test("GPU create/update reject a malformed cudaVersion and accept a valid one", async () => {
  const user = { _id: "prov1", role: "PROVIDER" };
  let s = gpuCtl([]);
  let res = mockRes();
  await quiet(() => s.ctl.createGPU(mockReq({ body: { gpuModel: "X", gpuMemory: 8, cudaVersion: "latest", pricePerHour: 1 }, user }), res));
  assert.equal(res.statusCode, 400);
  assert.equal(s.gpus.length, 0);

  s = gpuCtl([{ _id: "g1", providerId: "prov1", status: "ACTIVE", cudaVersion: "12.2" }]);
  res = mockRes();
  await quiet(() => s.ctl.updateGPU(mockReq({ params: { id: "g1" }, body: { cudaVersion: "v12" }, user }), res));
  assert.equal(res.statusCode, 400);
  res = mockRes();
  await quiet(() => s.ctl.updateGPU(mockReq({ params: { id: "g1" }, body: { cudaVersion: "12.10" }, user }), res));
  assert.equal(res.statusCode, 200);
  assert.equal(s.gpus[0].cudaVersion, "12.10");
});
