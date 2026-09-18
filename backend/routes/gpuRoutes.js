/**
 * routes/gpuRoutes.js
 * GPU resource routes — GPU Compute Exchange
 *
 * All routes require authentication (protect).
 * Write operations require PROVIDER role.
 */

const express = require("express");
const router = express.Router();
const { protect } = require("../middleware/authMiddleware");
const { requireRole } = require("../middleware/roleMiddleware");
const {
  createGPU,
  listGPUs,
  getGPU,
  updateGPU,
  deleteGPU,
} = require("../controllers/gpuController");

// GET  /api/gpus        — authenticated (marketplace)
router.get("/", protect, listGPUs);

// GET  /api/gpus/:id    — authenticated
router.get("/:id", protect, getGPU);

// POST /api/gpus        — PROVIDER only
router.post("/", protect, requireRole("PROVIDER"), createGPU);

// PUT  /api/gpus/:id    — PROVIDER only (ownership checked in controller)
router.put("/:id", protect, requireRole("PROVIDER"), updateGPU);

// DELETE /api/gpus/:id  — PROVIDER only (ownership checked in controller)
router.delete("/:id", protect, requireRole("PROVIDER"), deleteGPU);

module.exports = router;
