/**
 * routes/jobRoutes.js
 * Job resource routes — GPU Compute Exchange
 *
 * All routes require authentication (protect).
 * Job creation is restricted to CONSUMER role.
 */

const express = require("express");
const router = express.Router();
const { protect } = require("../middleware/authMiddleware");
const { requireRole } = require("../middleware/roleMiddleware");
const {
  createJob,
  listJobs,
  getJob,
  getJobResult,
} = require("../controllers/jobController");

// GET  /api/jobs              — Consumer (own jobs) | Provider (jobs on their GPUs)
router.get("/", protect, listJobs);

// GET  /api/jobs/:id          — Consumer owner OR provider with GPU ownership
router.get("/:id", protect, getJob);

// GET  /api/jobs/:id/result   — Same access as getJob
router.get("/:id/result", protect, getJobResult);

// POST /api/jobs              — CONSUMER only
router.post("/", protect, requireRole("CONSUMER"), createJob);

module.exports = router;
