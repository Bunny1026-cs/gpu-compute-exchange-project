/**
 * test/matcher.test.js
 * Focused tests of the pure matcher (scheduler/matcher.js).
 *
 * These replace the unavailable original scheduler test script for the
 * matcher's CURRENT, intended behaviour. Known defects tracked as P1-1
 * (multi-digit CUDA minor versions, maximumPrice = 0, non-numeric
 * requirements) are intentionally not asserted here.
 */

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { isCompatible, rankGPUs, findBestGPU } = require("../scheduler/matcher");

const base = { _id: "a", availability: true, status: "ACTIVE", gpuMemory: 24, cudaVersion: "12.2", pricePerHour: 100 };
const g = (extra) => ({ ...base, ...extra });

test("accepts a GPU that meets all requirements", () => {
  assert.equal(isCompatible(g(), { requiredGpuMemory: 16, requiredCudaVersion: "12.0", maximumPrice: 150 }), true);
});
test("accepts any listed ACTIVE GPU when no requirements are given", () => {
  assert.equal(isCompatible(g(), {}), true);
});
test("rejects insufficient memory", () => {
  assert.equal(isCompatible(g({ gpuMemory: 8 }), { requiredGpuMemory: 16 }), false);
});
test("rejects an older CUDA version (single-digit minor versions)", () => {
  assert.equal(isCompatible(g({ cudaVersion: "11.8" }), { requiredCudaVersion: "12.1" }), false);
});
test("rejects a price above maximumPrice", () => {
  assert.equal(isCompatible(g({ pricePerHour: 200 }), { maximumPrice: 150 }), false);
});
test("rejects an unlisted (availability=false) GPU", () => {
  assert.equal(isCompatible(g({ availability: false }), {}), false);
});
test("rejects INACTIVE and BUSY GPUs", () => {
  assert.equal(isCompatible(g({ status: "INACTIVE" }), {}), false);
  assert.equal(isCompatible(g({ status: "BUSY" }), {}), false);
});
test("ranks by lowest price first", () => {
  const ranked = rankGPUs([g({ _id: "x", pricePerHour: 90 }), g({ _id: "y", pricePerHour: 40 })]);
  assert.deepEqual(ranked.map((r) => r._id), ["y", "x"]);
});
test("breaks price ties by smallest sufficient memory", () => {
  const ranked = rankGPUs([g({ _id: "x", gpuMemory: 48 }), g({ _id: "y", gpuMemory: 24 })]);
  assert.deepEqual(ranked.map((r) => r._id), ["y", "x"]);
});
test("breaks remaining ties deterministically by id", () => {
  const ranked = rankGPUs([g({ _id: "b" }), g({ _id: "a" })]);
  assert.deepEqual(ranked.map((r) => r._id), ["a", "b"]);
});
test("rankGPUs does not mutate its input", () => {
  const input = [g({ _id: "x", pricePerHour: 90 }), g({ _id: "y", pricePerHour: 40 })];
  rankGPUs(input);
  assert.deepEqual(input.map((r) => r._id), ["x", "y"]);
});
test("findBestGPU reads requirements from job.input.requirements", () => {
  const job = { input: { requirements: { requiredGpuMemory: 32 } } };
  const best = findBestGPU(job, [g({ _id: "small", gpuMemory: 24, pricePerHour: 10 }), g({ _id: "big", gpuMemory: 40, pricePerHour: 50 })]);
  assert.equal(best._id, "big");
});
test("findBestGPU returns null when nothing is compatible", () => {
  assert.equal(findBestGPU({ input: { requirements: { requiredGpuMemory: 80 } } }, [g()]), null);
});
test("findBestGPU handles a job with input = null", () => {
  assert.equal(findBestGPU({ input: null }, [g()])._id, "a");
});
