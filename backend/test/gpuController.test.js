/**
 * test/gpuController.test.js
 * P0-4: providers cannot set BUSY, cannot change status/availability of a
 * BUSY GPU, and cannot delete a BUSY GPU. Normal operations still work.
 */

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { makeModel } = require("./helpers/inMemoryModels");
const { loadWithStubs, quiet } = require("./helpers/loadWithStubs");
const { mockReq, mockRes } = require("./helpers/httpMocks");

const GPU_STATUS = Object.freeze({ ACTIVE: "ACTIVE", INACTIVE: "INACTIVE", BUSY: "BUSY" });
const PROVIDER = { _id: "prov1", role: "PROVIDER" };
const OTHER = { _id: "prov2", role: "PROVIDER" };

function setup(gpus) {
  const GPU = makeModel(gpus);
  GPU.GPU_STATUS = GPU_STATUS;
  const ctl = loadWithStubs("controllers/gpuController.js", { "models/GPU.js": GPU });
  return { ctl, GPU, gpus };
}
const gpu = (id, status, extra = {}) => ({ _id: id, providerId: "prov1", gpuModel: "RTX", gpuMemory: 24,
  cudaVersion: "12.2", pricePerHour: 100, availability: status !== GPU_STATUS.BUSY, status, ...extra });

async function call(fn, reqInit) {
  const res = mockRes();
  await quiet(() => fn(mockReq(reqInit), res));
  return res;
}

test("updating status of a BUSY GPU returns 409 and changes nothing", async () => {
  const s = setup([gpu("g1", GPU_STATUS.BUSY)]);
  const res = await call(s.ctl.updateGPU, { params: { id: "g1" }, body: { status: "ACTIVE" }, user: PROVIDER });
  assert.equal(res.statusCode, 409);
  assert.equal(s.gpus[0].status, GPU_STATUS.BUSY);
});

test("updating availability of a BUSY GPU returns 409 and changes nothing", async () => {
  const s = setup([gpu("g1", GPU_STATUS.BUSY)]);
  const res = await call(s.ctl.updateGPU, { params: { id: "g1" }, body: { availability: true }, user: PROVIDER });
  assert.equal(res.statusCode, 409);
  assert.equal(s.gpus[0].availability, false);
});

test("a provider cannot set status BUSY via update", async () => {
  const s = setup([gpu("g1", GPU_STATUS.ACTIVE)]);
  const res = await call(s.ctl.updateGPU, { params: { id: "g1" }, body: { status: "BUSY" }, user: PROVIDER });
  assert.equal(res.statusCode, 400);
  assert.equal(s.gpus[0].status, GPU_STATUS.ACTIVE);
});

test("a provider cannot create a GPU with status BUSY", async () => {
  const s = setup([]);
  const res = await call(s.ctl.createGPU, {
    body: { gpuModel: "RTX", gpuMemory: 24, cudaVersion: "12.2", pricePerHour: 100, status: "BUSY" }, user: PROVIDER,
  });
  assert.equal(res.statusCode, 400);
  assert.equal(s.gpus.length, 0);
});

test("GPU becoming BUSY between the read and the write: status update returns 409", async () => {
  const s = setup([gpu("g1", GPU_STATUS.ACTIVE)]);
  const realFind = s.GPU.findById;
  s.GPU.findById = (id) => {
    const q = realFind(id);
    const then = q.then.bind(q);
    q.then = (ok, ko) => then((doc) => { s.gpus[0].status = GPU_STATUS.BUSY; return doc; }).then(ok, ko); // scheduler claims it
    return q;
  };
  const res = await call(s.ctl.updateGPU, { params: { id: "g1" }, body: { status: "INACTIVE" }, user: PROVIDER });
  assert.equal(res.statusCode, 409);
  assert.equal(s.gpus[0].status, GPU_STATUS.BUSY);
});

test("deleting a BUSY GPU returns 409 and keeps it", async () => {
  const s = setup([gpu("g1", GPU_STATUS.BUSY)]);
  const res = await call(s.ctl.deleteGPU, { params: { id: "g1" }, user: PROVIDER });
  assert.equal(res.statusCode, 409);
  assert.equal(s.gpus.length, 1);
});

test("GPU becoming BUSY between the check and the delete: returns 409 and keeps it", async () => {
  const s = setup([gpu("g1", GPU_STATUS.ACTIVE)]);
  const realFind = s.GPU.findById;
  s.GPU.findById = (id) => {
    const q = realFind(id);
    const then = q.then.bind(q);
    q.then = (ok, ko) => then((doc) => { s.gpus[0].status = GPU_STATUS.BUSY; return doc; }).then(ok, ko);
    return q;
  };
  const res = await call(s.ctl.deleteGPU, { params: { id: "g1" }, user: PROVIDER });
  assert.equal(res.statusCode, 409);
  assert.equal(s.gpus.length, 1);
});

test("normal: provider creates an ACTIVE GPU", async () => {
  const s = setup([]);
  const res = await call(s.ctl.createGPU, {
    body: { gpuModel: "RTX", gpuMemory: 24, cudaVersion: "12.2", pricePerHour: 100 }, user: PROVIDER,
  });
  assert.equal(res.statusCode, 201);
  assert.equal(s.gpus[0].status, "ACTIVE");
});

test("normal: provider sets an ACTIVE GPU to INACTIVE and unlists it", async () => {
  const s = setup([gpu("g1", GPU_STATUS.ACTIVE)]);
  const res = await call(s.ctl.updateGPU, { params: { id: "g1" }, body: { status: "INACTIVE", availability: false }, user: PROVIDER });
  assert.equal(res.statusCode, 200);
  assert.equal(s.gpus[0].status, GPU_STATUS.INACTIVE);
  assert.equal(s.gpus[0].availability, false);
});

test("normal: provider may change the price of a BUSY GPU (no status/availability change)", async () => {
  const s = setup([gpu("g1", GPU_STATUS.BUSY)]);
  const res = await call(s.ctl.updateGPU, { params: { id: "g1" }, body: { pricePerHour: 120 }, user: PROVIDER });
  assert.equal(res.statusCode, 200);
  assert.equal(s.gpus[0].pricePerHour, 120);
  assert.equal(s.gpus[0].status, GPU_STATUS.BUSY);
});

test("normal: provider deletes a non-BUSY GPU", async () => {
  const s = setup([gpu("g1", GPU_STATUS.INACTIVE)]);
  const res = await call(s.ctl.deleteGPU, { params: { id: "g1" }, user: PROVIDER });
  assert.equal(res.statusCode, 200);
  assert.equal(s.gpus.length, 0);
});

test("ownership is still enforced: another provider gets 403", async () => {
  const s = setup([gpu("g1", GPU_STATUS.ACTIVE)]);
  const up = await call(s.ctl.updateGPU, { params: { id: "g1" }, body: { pricePerHour: 1 }, user: OTHER });
  const del = await call(s.ctl.deleteGPU, { params: { id: "g1" }, user: OTHER });
  assert.equal(up.statusCode, 403);
  assert.equal(del.statusCode, 403);
  assert.equal(s.gpus[0].pricePerHour, 100);
});
