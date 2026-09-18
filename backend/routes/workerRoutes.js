/**
 * routes/workerRoutes.js
 * GPU Worker API routes — GPU Compute Exchange
 *
 * Endpoints consumed by the Python GPU worker process.
 * Authentication: X-Worker-API-Key header (shared secret).
 *
 * Routes:
 *   GET  /api/worker/jobs              — Poll for ASSIGNED jobs
 *   POST /api/worker/jobs/:id/start    — Mark job as RUNNING
 *   POST /api/worker/jobs/:id/result   — Submit result (hash + IPFS)
 *   POST /api/worker/jobs/:id/fail     — Mark job as FAILED
 *   POST /api/worker/jobs/:id/complete — Trigger verification + payment
 *   GET  /api/worker/ipfs/:cid         — Retrieve IPFS content
 */

"use strict";

const express = require("express");
const router  = express.Router();

const {
  authenticateWorker,
  fetchAssignedJobs,
  startJob,
  submitResult,
  failJob,
  completeJob,
  getIPFSContent,
} = require("../controllers/workerController");

// All worker routes require the API key
router.use(authenticateWorker);

// Job lifecycle
router.get("/jobs",              fetchAssignedJobs);
router.post("/jobs/:id/start",   startJob);
router.post("/jobs/:id/result",  submitResult);
router.post("/jobs/:id/fail",    failJob);
router.post("/jobs/:id/complete",completeJob);

// IPFS
router.get("/ipfs/:cid",        getIPFSContent);

module.exports = router;
