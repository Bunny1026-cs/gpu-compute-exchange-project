/**
 * routes/schedulerRoutes.js
 * Development scheduler endpoint — GPU Compute Exchange (Phase 5)
 *
 * ⚠️  DEVELOPMENT ONLY — Not intended for production use.
 *     This endpoint manually triggers one scheduler cycle for testing.
 *     In production, the scheduler runs automatically via polling.
 *
 * Routes:
 *   POST /api/dev/scheduler/run  — Run one scheduling cycle immediately
 */

"use strict";

const express = require("express");
const router = express.Router();
const { protect } = require("../middleware/authMiddleware");
const { runSchedulerCycle } = require("../scheduler/scheduler");

/**
 * POST /api/dev/scheduler/run
 * Manually triggers one scheduler cycle.
 * Useful for testing and development — no need to wait for the polling interval.
 * Protected: requires a valid JWT (any authenticated user).
 */
router.post("/scheduler/run", protect, async (req, res) => {
  try {
    console.log(`[Dev] Manual scheduler trigger by user ${req.user._id} (${req.user.role})`);
    const result = await runSchedulerCycle();
    return res.status(200).json({
      success: true,
      message: "Scheduler cycle complete.",
      result,
      note: "This is a development endpoint. The scheduler also runs automatically on a polling interval.",
    });
  } catch (err) {
    console.error("[Dev] Scheduler trigger error:", err.message);
    return res.status(500).json({ success: false, message: "Scheduler cycle failed: " + err.message });
  }
});

module.exports = router;
