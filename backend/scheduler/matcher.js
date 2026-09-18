/**
 * scheduler/matcher.js
 * GPU Compatibility Matcher — GPU Compute Exchange (Phase 5)
 *
 * Pure functions — ZERO database calls, fully unit-testable.
 * The scheduler passes plain JS objects; this module never imports Mongoose.
 *
 * Matching rules:
 *   1. availability === true
 *   2. status === "ACTIVE"
 *   3. gpuMemory >= requirements.requiredGpuMemory  (if specified)
 *   4. CUDA major.minor >= requirements.requiredCudaVersion  (if specified)
 *   5. pricePerHour <= requirements.maximumPrice  (if specified)
 *
 * Ranking (lower sort key = preferred):
 *   1. pricePerHour ascending
 *   2. gpuMemory ascending (smallest sufficient)
 *   3. _id string ascending (deterministic tie-breaker)
 */

"use strict";

/**
 * parseCuda
 * Converts a CUDA version string like "12.2" into a comparable float.
 * Returns 0 if unparseable.
 *
 * @param {string|number} v
 * @returns {number}
 */
function parseCuda(v) {
  if (v === null || v === undefined) return 0;
  const n = parseFloat(String(v));
  return isNaN(n) ? 0 : n;
}

/**
 * isCompatible
 * Returns true if a GPU satisfies all of the job's requirements.
 *
 * @param {object} gpu          - Plain GPU document (or POJO with same fields)
 * @param {object} requirements - { requiredGpuMemory?, requiredCudaVersion?, maximumPrice? }
 * @returns {boolean}
 */
function isCompatible(gpu, requirements = {}) {
  // Must be listed and active
  if (!gpu.availability)         return false;
  if (gpu.status !== "ACTIVE")   return false;

  // Memory check
  const reqMem = Number(requirements.requiredGpuMemory);
  if (!isNaN(reqMem) && reqMem > 0) {
    if (gpu.gpuMemory < reqMem) return false;
  }

  // CUDA version check (>= required)
  const reqCuda = requirements.requiredCudaVersion;
  if (reqCuda !== null && reqCuda !== undefined && String(reqCuda).trim() !== "") {
    if (parseCuda(gpu.cudaVersion) < parseCuda(reqCuda)) return false;
  }

  // Price check
  const maxPrice = Number(requirements.maximumPrice);
  if (!isNaN(maxPrice) && maxPrice > 0) {
    if (gpu.pricePerHour > maxPrice) return false;
  }

  return true;
}

/**
 * rankGPUs
 * Sorts a list of compatible GPUs by preference (lowest rank = best).
 * Modifies a copy — does not mutate the original array.
 *
 * Ranking criteria (in order):
 *   1. pricePerHour ascending
 *   2. gpuMemory ascending
 *   3. _id.toString() ascending (deterministic)
 *
 * @param {object[]} gpus
 * @returns {object[]} sorted copy
 */
function rankGPUs(gpus) {
  return [...gpus].sort((a, b) => {
    // 1. Price
    if (a.pricePerHour !== b.pricePerHour) return a.pricePerHour - b.pricePerHour;
    // 2. Memory
    if (a.gpuMemory !== b.gpuMemory)       return a.gpuMemory - b.gpuMemory;
    // 3. ID tie-breaker
    return String(a._id) < String(b._id) ? -1 : 1;
  });
}

/**
 * findBestGPU
 * Main entry point.
 * Given a job and a pool of GPU candidates, returns the best compatible GPU
 * or null if none qualify.
 *
 * @param {object}   job  - Job document or POJO (reads job.input?.requirements)
 * @param {object[]} gpus - Array of GPU documents or POJOs
 * @returns {object|null}  Best GPU, or null if no compatible GPU found
 */
function findBestGPU(job, gpus) {
  const requirements = (job.input && job.input.requirements) || {};

  const compatible = gpus.filter((gpu) => isCompatible(gpu, requirements));
  if (compatible.length === 0) return null;

  const ranked = rankGPUs(compatible);
  return ranked[0];
}

module.exports = { findBestGPU, isCompatible, rankGPUs, parseCuda };
