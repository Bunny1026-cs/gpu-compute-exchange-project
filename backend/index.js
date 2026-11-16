/**
 * GPU Compute Exchange — Backend API
 * Local-demo backend: authentication, scheduling, worker integration,
 * mock/real IPFS integration, and optional local-Hardhat escrow integration.
 *
 * Process entry point: connects MongoDB, initialises services, starts the
 * scheduler, and listens. The Express app itself is defined in app.js.
 */

// Load environment variables FIRST — before any other imports
require("dotenv").config();

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
  await ipfsService.initialize();
  // Start the scheduler polling loop
  startSchedulerPolling();
});

// ── Start ─────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`✅  Backend running on http://localhost:${PORT}`);
  console.log(`ℹ️   Development routes (/api/dev/*): ${isDevRoutesEnabled() ? "ENABLED" : "disabled"}`);
});
