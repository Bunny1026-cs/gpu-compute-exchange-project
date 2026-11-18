/**
 * GPU Compute Exchange — Backend API
 * Local-demo backend: authentication, scheduling, worker integration,
 * mock/real IPFS integration, and optional local-Hardhat escrow integration.
 *
 * Process entry point: connects MongoDB, initialises services, starts the
 * scheduler, and listens. The Express app itself is defined in app.js.
 */

// Load environment variables FIRST — before any other imports
require("dotenv").config({ path: process.env.BACKEND_ENV_FILE || require("path").join(__dirname, ".env") });

process.env.EXECUTION_MODE ||= "real_gpu";
if (!["real_gpu", "real_cpu_test"].includes(process.env.EXECUTION_MODE)) throw new Error("Only real execution modes are supported");
if (process.env.FINAL_DEMO === "true" && process.env.EXECUTION_MODE !== "real_gpu") throw new Error("Final demo requires real_gpu");
if (process.env.EXECUTION_MODE === "real_cpu_test" && (process.env.FINAL_DEMO !== "false" || process.env.NODE_ENV === "production")) throw new Error("CPU testing requires FINAL_DEMO=false and a development environment");
const connectDB = require("./config/db");
const app = require("./app");
const { startSchedulerPolling } = require("./scheduler/scheduler");
const blockchainService = require("./blockchain/blockchainService");
const ipfsService       = require("./services/ipfsService");
const { isDevRoutesEnabled } = require("./config/devRoutes");

const PORT = process.env.PORT || 5000;

// ── Connect to Database + Initialize Services ─────────────────
connectDB().then(async () => {
  // Initialize blockchain service (non-blocking — gracefully degrades if unavailable)
  await blockchainService.initialize();
  // Initialize IPFS service (non-blocking — uses mock mode if IPFS unavailable)
  // Real artifacts use explicitly labeled local file storage.
  // Start the scheduler polling loop
  const compute = require("./services/realCompute");
  setInterval(() => compute.cycle().catch((error) => console.error("Compute cycle:", error.message)), 3000);
});

// ── Start ─────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`✅  Backend running on http://localhost:${PORT}`);
  console.log(`ℹ️   Development routes (/api/dev/*): ${isDevRoutesEnabled() ? "ENABLED" : "disabled"}`);
});
