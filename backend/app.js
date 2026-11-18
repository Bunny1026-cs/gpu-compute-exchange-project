/**
 * app.js
 * GPU Compute Exchange — Express application (routes + middleware).
 *
 * Separated from index.js so the HTTP layer can be exercised in tests without
 * connecting to MongoDB or starting the scheduler. index.js remains the
 * process entry point.
 */

require("dotenv").config();

const express = require("express");
const cors = require("cors");

// ── Routes ────────────────────────────────────────────────────
const authRoutes       = require("./routes/authRoutes");
const gpuRoutes        = require("./routes/gpuRoutes");
const jobRoutes        = require("./routes/jobRoutes");
const schedulerRoutes  = require("./routes/schedulerRoutes");
const blockchainRoutes = require("./routes/blockchainRoutes");
const workerRoutes     = require("./routes/workerRoutes");

// ── Blockchain service ─────────────────────────────────────
const blockchainService = require("./blockchain/blockchainService");

const { isDevRoutesEnabled } = require("./config/devRoutes");

const app = express();

// ── Middleware ────────────────────────────────────────────────
app.use(cors());
app.use(express.json());

// ── API Routes ────────────────────────────────────────────────
const realExecution = ["real_gpu", "real_cpu_test"].includes(process.env.EXECUTION_MODE);
if (realExecution) app.use("/api", require("./routes/realRoutes"));

app.use("/api/auth",  authRoutes);
app.use("/api/gpus",  gpuRoutes);
app.use("/api/jobs",  jobRoutes);
// ⚠️ Development-only routes (P0-1): mounted ONLY when ENABLE_DEV_ROUTES=true
// and NODE_ENV !== "production". When not mounted, requests fall through to
// the 404 handler below.
const devRoutesEnabled = isDevRoutesEnabled();
if (devRoutesEnabled && !realExecution) {
  app.use("/api/dev", schedulerRoutes);
  app.use("/api/dev", blockchainRoutes);
}
if (!realExecution) app.use("/api/worker", workerRoutes);       // GPU Worker API (API key auth)

// ── Health Check ──────────────────────────────────────────────
app.get("/health", (req, res) => {
  const mongoose = require("mongoose");
  res.json({
    status: "ok",
    service: "gpu-compute-exchange-backend",
    version: "1.0.0",
    phase: realExecution ? "Real computation with receipt-confirmed escrow" : "Legacy regression fixture",
    executionMode: process.env.EXECUTION_MODE || "legacy",
    timestamp: new Date().toISOString(),
    scheduler: {
      interval: process.env.SCHEDULER_INTERVAL_MS || "10000",
      devTrigger: devRoutesEnabled ? "POST /api/dev/scheduler/run" : null,
    },
    devRoutesEnabled,
    blockchain: {
      available:       blockchainService.isAvailable(),
      rpcUrl:          process.env.BLOCKCHAIN_RPC_URL || null,
      contractAddress: process.env.ESCROW_CONTRACT_ADDRESS || null,
      demoMode:        process.env.BLOCKCHAIN_DEMO_MODE === "true",
      // ⚠️ Private keys are NEVER included
    },
    database: {
      status: mongoose.connection.readyState === 1 ? "connected" : "disconnected",
      state: ["disconnected", "connected", "connecting", "disconnecting"][
        mongoose.connection.readyState
      ],
    },
  });
});

// ── Root ──────────────────────────────────────────────────────
app.get("/", (req, res) => {
  res.json({
    message: "GPU Compute Exchange API",
    version: "0.3.0",
    endpoints: {
      auth: {
        register: "POST /api/auth/register",
        login:    "POST /api/auth/login",
      },
      gpus: {
        list:   "GET  /api/gpus",
        get:    "GET  /api/gpus/:id",
        create: "POST /api/gpus         (PROVIDER)",
        update: "PUT  /api/gpus/:id     (PROVIDER — own GPU)",
        delete: "DELETE /api/gpus/:id   (PROVIDER — own GPU)",
      },
      jobs: {
        list:   "GET  /api/jobs",
        get:    "GET  /api/jobs/:id",
        result: "GET  /api/jobs/:id/result",
        create: "POST /api/jobs         (CONSUMER)",
      },
    },
  });
});

// ── 404 Handler ───────────────────────────────────────────────
app.use((req, res) => {
  res.status(404).json({ success: false, message: `Route not found: ${req.method} ${req.path}` });
});

// ── Global Error Handler ──────────────────────────────────────
// Must have 4 parameters for Express to treat it as an error handler.
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  console.error("Unhandled error:", err.message);
  const statusCode = err.statusCode || 500;
  res.status(statusCode).json({
    success: false,
    message: process.env.NODE_ENV === "production" ? "Internal server error." : err.message,
  });
});

module.exports = app;
