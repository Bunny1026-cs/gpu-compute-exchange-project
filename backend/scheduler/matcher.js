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
 *   4. CUDA version >= requirements.requiredCudaVersion  (if specified)
 *      compared numerically per component (P1-1): 11.10 > 11.8
 *   5. pricePerHour <= requirements.maximumPrice  (if specified; 0 is a
 *      real limit meaning "free GPUs only")
 *
 * A requirement that is present but malformed matches NO GPU (P1-1); it is
 * never silently ignored. createJob() rejects such input with HTTP 400, so
 * this only guards against legacy or directly inserted data.
 *
 * Ranking (lower sort key = preferred):
 *   1. pricePerHour ascending
 *   2. gpuMemory ascending (smallest sufficient)
 *   3. _id string ascending (deterministic tie-breaker)
 */

"use strict";

const CUDA_VERSION_REGEX = /^\d+(\.\d+){0,2}$/;

/**
 * parseCuda (P1-1)
 * Parses a CUDA version string such as "12", "12.2" or "12.2.1" into a
 * [major, minor, patch] array of integers (missing parts = 0).
 * Returns null if the value is not a valid version string.
 *
 * The previous implementation used parseFloat(), which compared "11.10"
 * as 11.1 (< 11.8).
 *
 * @param {string|number} v
 * @returns {number[]|null}
 */
function parseCuda(v) {
  if (v === null || v === undefined) return null;
  const str = String(v).trim();
  if (!CUDA_VERSION_REGEX.test(str)) return null;
  const parts = str.split(".").map((x) => parseInt(x, 10));
  while (parts.length < 3) parts.push(0);
  return parts;
}

/**
 * compareCuda (P1-1)
 * Returns a negative number, 0, or a positive number like a sort comparator.
 * Both arguments must be valid (non-null) results of parseCuda().
 */
function compareCuda(a, b) {
  for (let i = 0; i < 3; i++) {
    if (a[i] !== b[i]) return a[i] - b[i];
  }
  return 0;
}

/** true when a requirement field was supplied (null/undefined/"" = absent) */
function isPresent(v) {
  return v !== null && v !== undefined && String(v).trim() !== "";
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
  if (isPresent(requirements.requiredGpuMemory)) {
    const reqMem = Number(requirements.requiredGpuMemory);
    if (!Number.isFinite(reqMem) || reqMem < 0) return false;     // malformed
    if (gpu.gpuMemory < reqMem) return false;
  }

  // CUDA version check (>= required), numeric per component
  if (isPresent(requirements.requiredCudaVersion)) {
    const req = parseCuda(requirements.requiredCudaVersion);
    const have = parseCuda(gpu.cudaVersion);
    if (!req || !have) return false;                               // malformed
    if (compareCuda(have, req) < 0) return false;
  }

  // Price check (0 is a valid limit)
  if (isPresent(requirements.maximumPrice)) {
    const maxPrice = Number(requirements.maximumPrice);
    if (!Number.isFinite(maxPrice) || maxPrice < 0) return false;  // malformed
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

module.exports = { findBestGPU, isCompatible, rankGPUs, parseCuda, compareCuda, CUDA_VERSION_REGEX };
