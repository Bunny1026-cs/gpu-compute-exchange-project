/**
 * scheduler/queue.js
 * Job Queue helpers — GPU Compute Exchange (Phase 5)
 *
 * MongoDB query helpers used by the scheduler.
 * Keeps all DB-read logic out of scheduler.js.
 *
 * These are READ-ONLY helpers. All writes happen in scheduler.js
 * using atomic operations.
 */

"use strict";

const Job = require("../models/Job");
const GPU = require("../models/GPU");

/**
 * getQueuedJobs
 * Returns all jobs currently in QUEUED status, oldest first.
 * Does not populate gpuId (it's null at this stage).
 *
 * @returns {Promise<Job[]>}
 */
async function getQueuedJobs() {
  return Job.find({ status: "QUEUED" })
    .sort({ createdAt: 1 })  // FIFO — oldest job first
    .lean();                 // plain JS objects for the matcher (no Mongoose overhead)
}

/**
 * getAvailableGPUs
 * Returns all GPUs that are currently available and active.
 * The scheduler will further filter these per-job using the matcher.
 *
 * @returns {Promise<GPU[]>}
 */
async function getAvailableGPUs() {
  return GPU.find({ availability: true, status: "ACTIVE" })
    .lean();
}

module.exports = { getQueuedJobs, getAvailableGPUs };
