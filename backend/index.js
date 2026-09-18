/**
 * GPU Compute Exchange — Backend API
 * Local-demo backend: authentication, scheduling, worker integration,
 * mock/real IPFS integration, and optional local-Hardhat escrow integration.
 */

// Load environment variables FIRST — before any other imports
require("dotenv").config();

const express = require("express");
const cors = require("cors");
const connectDB = require("./config/db");

// ── Routes ────────────────────────────────────────────────────
const authRoutes       = require("./routes/authRoutes");
const gpuRoutes        = require("./routes/gpuRoutes");
const jobRoutes        = require("./routes/jobRoutes");
const schedulerRoutes  = require("./routes/schedulerRoutes");
const blockchainRoutes = require("./routes/blockchainRoutes");
const workerRoutes     = require("./routes/workerRoutes");

// ── Scheduler ─────────────────────────────────────────────────
const { startSchedulerPolling } = require("./scheduler/scheduler");

// ── Blockchain service ─────────────────────────────────────
const blockchainService = require("./blockchain/blockchainService");
const ipfsService       = require("./services/ipfsService");

const app = express();
const PORT = process.env.PORT || 5000;

// ── Connect to Database + Initialize Services ─────────────────
connectDB().then(async () => {
  // Initialize blockchain service (non-blocking — gracefully degrades if unavailable)
  await blockchainService.initialize();
  // Initialize IPFS service (non-blocking — uses mock mode if IPFS unavailable)
  await ipfsService.initialize();
  // Start the scheduler polling loop
  startSchedulerPolling();
});

// ── Middleware ────────────────────────────────────────────────
app.use(cors());
app.use(express.json());

// ── API Routes ────────────────────────────────────────────────
app.use("/api/auth",  authRoutes);
app.use("/api/gpus",  gpuRoutes);
app.use("/api/jobs",  jobRoutes);
app.use("/api/dev",   schedulerRoutes);   // ⚠️ Development only
app.use("/api/dev",   blockchainRoutes);   // ⚠️ Development only — demo blockchain
app.use("/api/worker", workerRoutes);       // GPU Worker API (API key auth)

// ── Health Check ──────────────────────────────────────────────
app.get("/health", (req, res) => {
  const mongoose = require("mongoose");
  res.json({
    status: "ok",
    service: "gpu-compute-exchange-backend",
    version: "1.0.0",
    phase: "Complete — Full Pipeline",
    timestamp: new Date().toISOString(),
    scheduler: {
      interval: process.env.SCHEDULER_INTERVAL_MS || "10000",
      devTrigger: "POST /api/dev/scheduler/run",
    },
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

// ── Start ─────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`✅  Backend running on http://localhost:${PORT}`);
});
