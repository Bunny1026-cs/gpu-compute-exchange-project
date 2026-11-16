/**
 * routes/blockchainRoutes.js
 * Development blockchain endpoints — GPU Compute Exchange (Phase 7)
 *
 * ⚠️  DEVELOPMENT / DEMO ONLY
 * These endpoints demonstrate the local Hardhat escrow flow using
 * TEST ETH with ZERO real-world value.
 * They must NEVER be exposed on mainnet or a public network.
 *
 * Access (P0-1):
 *   - Mounted only when ENABLE_DEV_ROUTES=true and NODE_ENV !== "production"
 *     (see config/devRoutes.js and app.js).
 *   - Job-mutating routes require the caller to be the CONSUMER who owns
 *     the job. GET /blockchain/job/:id also allows the assigned provider.
 *
 * Routes:
 *   GET  /api/dev/blockchain/status            — service status + contract info
 *   GET  /api/dev/blockchain/escrow            — total escrow balance
 *   GET  /api/dev/blockchain/job/:id           — on-chain job state for a MongoDB job
 *   POST /api/dev/blockchain/demo-escrow/:id   — demo: register + deposit (DEMO ONLY)
 *   POST /api/dev/blockchain/assign/:id        — operator: call assignJob on-chain
 */

"use strict";

const express = require("express");
const router  = express.Router();
const { ethers } = require("ethers");

const { protect } = require("../middleware/authMiddleware");
const Job         = require("../models/Job");
const GPU         = require("../models/GPU");
const { JOB_STATUS } = require("../models/Job");
const { GPU_STATUS } = require("../models/GPU");
const Transaction = require("../models/Transaction");
const { TX_TYPE, TX_STATUS } = require("../models/Transaction");
const blockchainService = require("../blockchain/blockchainService");
const { BlockchainUnavailableError } = require("../blockchain/blockchainService");

// ── Helpers ────────────────────────────────────────────────────

/**
 * loadOwnedJob (P0-1)
 * Loads a job and allows the request to continue only when the caller is
 * the CONSUMER who owns it. Sends 400/403/404 itself and returns null on
 * failure, so handlers can simply `if (!job) return;`.
 *
 * @param {object} req
 * @param {object} res
 * @param {Function} [buildQuery] optional (query) => query, e.g. to populate
 * @returns {Promise<object|null>}
 */
async function loadOwnedJob(req, res, buildQuery) {
  let query = Job.findById(req.params.id);
  if (buildQuery) query = buildQuery(query);
  let job;
  try {
    job = await query;
  } catch (err) {
    if (err.name === "CastError") {
      res.status(400).json({ success: false, message: "Invalid job ID format." });
      return null;
    }
    throw err;
  }
  if (!job) {
    res.status(404).json({ success: false, message: "Job not found." });
    return null;
  }
  const consumerId = job.consumerId && job.consumerId._id ? job.consumerId._id : job.consumerId;
  if (req.user.role !== "CONSUMER" || String(consumerId) !== String(req.user._id)) {
    res.status(403).json({
      success: false,
      message: "Access denied. Only the consumer who owns this job may perform this operation.",
    });
    return null;
  }
  return job;
}

/**
 * releaseGpuIfHeld (P0-1)
 * After an on-chain refund/release ends a job that still held a GPU, return
 * that GPU to the pool. Conditional on the GPU still being BUSY so it never
 * overrides a provider's INACTIVE setting or a concurrent scheduler claim.
 */
const GPU_HOLDING_STATES = [JOB_STATUS.ASSIGNED, JOB_STATUS.RUNNING, JOB_STATUS.RESULT_UPLOADED];
async function releaseGpuIfHeld(job) {
  if (!job.gpuId || !GPU_HOLDING_STATES.includes(job.status)) return;
  const gpuId = job.gpuId && job.gpuId._id ? job.gpuId._id : job.gpuId;
  await GPU.findOneAndUpdate(
    { _id: gpuId, status: GPU_STATUS.BUSY },
    { $set: { status: GPU_STATUS.ACTIVE, availability: true } }
  );
}
function requireBlockchain(res) {
  if (!blockchainService.isAvailable()) {
    res.status(503).json({
      success: false,
      message: "Blockchain service not available. Start the Hardhat node, deploy the contract, and set blockchain env vars.",
      required: {
        BLOCKCHAIN_RPC_URL:       "http://127.0.0.1:8545",
        ESCROW_CONTRACT_ADDRESS:  "<address from deploy script>",
        BLOCKCHAIN_PRIVATE_KEY:   "<Hardhat Account[1] key>",
        DEMO_CONSUMER_PRIVATE_KEY:"<Hardhat Account[2] key>",
        BLOCKCHAIN_DEMO_MODE:     "true",
      },
    });
    return false;
  }
  return true;
}

// ═══════════════════════════════════════════════════════════════
// GET /api/dev/blockchain/status
// ═══════════════════════════════════════════════════════════════
/**
 * Returns the blockchain service status and contract configuration.
 * Safe to call — never exposes private keys.
 */
router.get("/blockchain/status", protect, async (req, res) => {
  try {
    const status = {
      available:    blockchainService.isAvailable(),
      initialized:  blockchainService.initialized,
      rpcUrl:       process.env.BLOCKCHAIN_RPC_URL  || null,
      contractAddress: process.env.ESCROW_CONTRACT_ADDRESS || null,
      operatorAddress: blockchainService.operatorWallet?.address ?? null,
      demoConsumerAddress: blockchainService.demoConsumerWallet?.address ?? null,
      demoMode:     process.env.BLOCKCHAIN_DEMO_MODE === "true",
      demoEscrowAmountWei: process.env.DEMO_ESCROW_AMOUNT_WEI || null,
      // ⚠️ Private keys are NEVER included in any response
    };

    if (blockchainService.isAvailable()) {
      try {
        const network = await blockchainService.provider.getNetwork();
        status.network = { name: network.name, chainId: network.chainId.toString() };
        status.escrowBalance = await blockchainService.getEscrowBalance();
      } catch (e) {
        status.networkError = e.message;
      }
    }

    res.json({ success: true, data: status });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ═══════════════════════════════════════════════════════════════
// GET /api/dev/blockchain/escrow
// ═══════════════════════════════════════════════════════════════
/**
 * Returns the total ETH held in escrow across all jobs.
 * ⚠️  DEMO ONLY — test ETH, no real value.
 */
router.get("/blockchain/escrow", protect, async (req, res) => {
  if (!requireBlockchain(res)) return;
  try {
    const balance = await blockchainService.getEscrowBalance();
    res.json({
      success: true,
      data: {
        ...balance,
        _note: "DEMO ONLY — Local Hardhat test ETH. Zero real-world value.",
      },
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ═══════════════════════════════════════════════════════════════
// GET /api/dev/blockchain/job/:id
// ═══════════════════════════════════════════════════════════════
/**
 * Reads the on-chain state for a MongoDB job.
 * :id is the MongoDB ObjectId.
 */
router.get("/blockchain/job/:id", protect, async (req, res) => {
  if (!requireBlockchain(res)) return;
  try {
    const dbJob = await Job.findById(req.params.id).populate("gpuId", "providerId");
    if (!dbJob) return res.status(404).json({ success: false, message: "Job not found in MongoDB." });

    // P0-1: only the owning consumer or the assigned GPU's provider may read
    const userId = String(req.user._id);
    const isOwner = String(dbJob.consumerId) === userId;
    const isAssignedProvider = req.user.role === "PROVIDER" && dbJob.gpuId &&
      dbJob.gpuId.providerId && String(dbJob.gpuId.providerId) === userId;
    if (!isOwner && !isAssignedProvider) {
      return res.status(403).json({ success: false, message: "Access denied. You are not authorized to view this job." });
    }

    const blockchainJobId = blockchainService.toBlockchainJobId(dbJob._id);
    const onChainJob = await blockchainService.getJob(blockchainJobId);

    res.json({
      success: true,
      data: {
        mongoJobId:       dbJob._id,
        mongoStatus:      dbJob.status,
        blockchainJobId,
        onChain:          onChainJob,
        blockchainTxHash: dbJob.blockchainTxHash,
        escrowAmountWei:  dbJob.escrowAmountWei,
        _note: "DEMO ONLY — Local Hardhat. Zero real-world value.",
      },
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ═══════════════════════════════════════════════════════════════
// POST /api/dev/blockchain/demo-escrow/:id
// ═══════════════════════════════════════════════════════════════
/**
 * ⚠️  DEMO / DEVELOPMENT ONLY
 * Demonstrates the full consumer-side escrow flow:
 *   1. Generates the deterministic blockchainJobId.
 *   2. Demo consumer registers the job on-chain.
 *   3. Demo consumer deposits DEMO_ESCROW_AMOUNT_WEI test ETH.
 *   4. Stores blockchainJobId + escrowAmountWei on the MongoDB job.
 *   5. Creates a Transaction record.
 *
 * This simulates what a real consumer would do via their own wallet.
 * Uses Hardhat test accounts — ZERO real money.
 */
router.post("/blockchain/demo-escrow/:id", protect, async (req, res) => {
  if (!requireBlockchain(res)) return;

  if (process.env.BLOCKCHAIN_DEMO_MODE !== "true") {
    return res.status(403).json({
      success: false,
      message: "Demo escrow is only available in BLOCKCHAIN_DEMO_MODE=true.",
    });
  }

  try {
    const dbJob = await loadOwnedJob(req, res);   // P0-1: owner only
    if (!dbJob) return;

    const amountWei = process.env.DEMO_ESCROW_AMOUNT_WEI || "1000000000000000"; // default 0.001 ETH
    const blockchainJobId = blockchainService.toBlockchainJobId(dbJob._id);

    // Step 1: Check if already registered
    const existing = await blockchainService.getJob(blockchainJobId);
    if (existing.status !== 0) {
      return res.status(400).json({
        success: false,
        message: `Job already registered on-chain. Current blockchain status: ${existing.statusLabel}`,
        data: { blockchainJobId, onChain: existing },
      });
    }

    // Step 2: Demo consumer registers the job
    const regReceipt = await blockchainService.demoRegisterJob(blockchainJobId);

    // Step 3: Demo consumer deposits funds
    const depReceipt = await blockchainService.demoDepositFunds(blockchainJobId, amountWei);

    // Step 4: Update MongoDB job
    await Job.findByIdAndUpdate(dbJob._id, {
      $set: {
        blockchainJobId,
        escrowAmountWei: amountWei,
        blockchainTxHash: depReceipt.txHash,
      },
    });

    // Step 5: Create Transaction record
    const txRecord = await Transaction.create({
      jobId:    dbJob._id,
      type:     TX_TYPE.ESCROW,
      txHash:   depReceipt.txHash,
      amount:   0,  // app price not used for blockchain escrow — kept separate
      status:   TX_STATUS.CONFIRMED,
      timestamp: new Date(),
    });

    const onChainState = await blockchainService.getJob(blockchainJobId);

    res.json({
      success: true,
      message: "Demo escrow complete. Test ETH deposited on local Hardhat (zero real value).",
      data: {
        mongoJobId:           dbJob._id,
        blockchainJobId,
        registerTxHash:       regReceipt.txHash,
        depositTxHash:        depReceipt.txHash,
        escrowAmountWei:      amountWei,
        escrowAmountEther:    ethers.formatEther(amountWei),
        transactionRecordId:  txRecord._id,
        onChain:              onChainState,
        _note: "⚠️  DEMO ONLY — Hardhat test ETH. Zero real-world value.",
      },
    });
  } catch (err) {
    console.error("[Blockchain Route] demo-escrow error:", err.message);
    res.status(500).json({ success: false, message: err.message });
  }
});

// ═══════════════════════════════════════════════════════════════
// POST /api/dev/blockchain/assign/:id
// ═══════════════════════════════════════════════════════════════
/**
 * Manually triggers operator assignJob() on-chain for a MongoDB job.
 * Requires the job to be FUNDED on-chain (demo-escrow must be done first).
 * Uses the operator wallet from BLOCKCHAIN_PRIVATE_KEY. Owning consumer only.
 *
 * The provider address is the walletAddress of the provider who owns the GPU
 * assigned by the scheduler. A request-body address is ignored (P0-1).
 */
router.post("/blockchain/assign/:id", protect, async (req, res) => {
  if (!requireBlockchain(res)) return;
  try {
    const dbJob = await loadOwnedJob(req, res, (q) => q.populate({   // P0-1: owner only
      path: "gpuId",
      populate: { path: "providerId", select: "walletAddress name" },
    }));
    if (!dbJob) return;

    const blockchainJobId = dbJob.blockchainJobId || blockchainService.toBlockchainJobId(dbJob._id);

    // P0-1: the provider address is taken ONLY from the provider of the GPU
    // the scheduler assigned. A request-body providerAddress is never trusted.
    const providerAddress = dbJob.gpuId?.providerId?.walletAddress || null;
    if (!providerAddress) {
      return res.status(400).json({
        success: false,
        message: "The job has no assigned GPU, or the assigned GPU's provider has no walletAddress.",
      });
    }

    const receipt = await blockchainService.assignJob(blockchainJobId, providerAddress);

    await Job.findByIdAndUpdate(dbJob._id, {
      $set: { blockchainTxHash: receipt.txHash },
    });

    const onChain = await blockchainService.getJob(blockchainJobId);

    res.json({
      success: true,
      message: "Blockchain job assigned.",
      data: {
        mongoJobId: dbJob._id,
        blockchainJobId,
        txHash:     receipt.txHash,
        onChain,
        _note: "⚠️  DEMO ONLY — Hardhat test ETH. Zero real-world value.",
      },
    });
  } catch (err) {
    console.error("[Blockchain Route] assign error:", err.message);
    res.status(500).json({ success: false, message: err.message });
  }
});

// ═══════════════════════════════════════════════════════════════
// POST /api/dev/blockchain/submit-result/:id
// ═══════════════════════════════════════════════════════════════
/**
 * ⚠️  DEMO ONLY — NOT IMPLEMENTED (returns 501)
 * submitResult() must be signed by the assigned provider's wallet, which the
 * backend does not hold. See audit item P0-6 (deferred).
 */
router.post("/blockchain/submit-result/:id", protect, (req, res) => {
  // P0-1: This route previously called a non-existent
  // blockchainService.submitResultAsOperator() and fell back to verifyResult()
  // with a fresh random hash, so it could never succeed. The contract requires
  // submitResult() to be signed by the ASSIGNED PROVIDER's wallet, which the
  // backend does not hold. Integrated on-chain result submission is a known
  // limitation (audit item P0-6, deferred), so this route reports that
  // explicitly instead of failing in a misleading way.
  return res.status(501).json({
    success: false,
    message:
      "On-chain result submission is not implemented in the integrated prototype. " +
      "GPUComputeEscrow.submitResult() must be signed by the assigned provider's wallet, " +
      "which the backend does not hold.",
  });
});

// ═══════════════════════════════════════════════════════════════
// POST /api/dev/blockchain/verify/:id
// ═══════════════════════════════════════════════════════════════
/**
 * ⚠️  DEMO ONLY — owning consumer only
 * Operator verifies the submitted result hash on-chain.
 * Compares the stored resultHash on the job with the on-chain submission.
 * The expected hash is always the job's stored resultHash; a request-body
 * value is ignored (P0-1).
 */
router.post("/blockchain/verify/:id", protect, async (req, res) => {
  if (!requireBlockchain(res)) return;
  try {
    const dbJob = await loadOwnedJob(req, res);   // P0-1: owner only
    if (!dbJob) return;

    const blockchainJobId = dbJob.blockchainJobId || blockchainService.toBlockchainJobId(dbJob._id);
    // P0-1: the expected hash is never taken from the request body.
    const expectedHash = dbJob.resultHash;

    if (!expectedHash) {
      return res.status(400).json({
        success: false,
        message: "No result hash available. Submit a result first.",
      });
    }

    const receipt = await blockchainService.verifyResult(blockchainJobId, expectedHash);

    await Job.findByIdAndUpdate(dbJob._id, {
      $set: { blockchainTxHash: receipt.txHash },
    });

    const onChain = await blockchainService.getJob(blockchainJobId);

    res.json({
      success: true,
      message: "Result verified on-chain.",
      data: {
        mongoJobId: dbJob._id,
        blockchainJobId,
        expectedResultHash: expectedHash,
        txHash: receipt.txHash,
        onChain,
        _note: "⚠️  DEMO ONLY — Hardhat test ETH. Zero real-world value.",
      },
    });
  } catch (err) {
    console.error("[Blockchain Route] verify error:", err.message);
    res.status(500).json({ success: false, message: err.message });
  }
});

// ═══════════════════════════════════════════════════════════════
// POST /api/dev/blockchain/release-payment/:id
// ═══════════════════════════════════════════════════════════════
/**
 * ⚠️  DEMO ONLY
 * Releases escrowed payment to the provider after verification.
 * Job must be in VERIFIED state on-chain.
 */
router.post("/blockchain/release-payment/:id", protect, async (req, res) => {
  if (!requireBlockchain(res)) return;
  try {
    const dbJob = await loadOwnedJob(req, res);   // P0-1: owner only
    if (!dbJob) return;

    const blockchainJobId = dbJob.blockchainJobId || blockchainService.toBlockchainJobId(dbJob._id);

    const receipt = await blockchainService.releasePayment(blockchainJobId);

    // P0-1: do not leave the job's GPU BUSY once the job has ended.
    await releaseGpuIfHeld(dbJob);

    // Update MongoDB — mark as COMPLETED
    await Job.findByIdAndUpdate(dbJob._id, {
      $set: {
        status: "COMPLETED",
        blockchainTxHash: receipt.txHash,
        completedAt: new Date(),
      },
    });

    // Create Transaction record for payment release
    await Transaction.create({
      jobId: dbJob._id,
      type: TX_TYPE.PAYMENT_RELEASE,
      txHash: receipt.txHash,
      amount: 0, // app price tracked separately
      status: TX_STATUS.CONFIRMED,
      timestamp: new Date(),
    });

    const onChain = await blockchainService.getJob(blockchainJobId);

    res.json({
      success: true,
      message: "Payment released to provider on-chain. Job marked COMPLETED.",
      data: {
        mongoJobId: dbJob._id,
        blockchainJobId,
        txHash: receipt.txHash,
        onChain,
        _note: "⚠️  DEMO ONLY — Hardhat test ETH. Zero real-world value.",
      },
    });
  } catch (err) {
    console.error("[Blockchain Route] release-payment error:", err.message);
    res.status(500).json({ success: false, message: err.message });
  }
});

// ═══════════════════════════════════════════════════════════════
// POST /api/dev/blockchain/refund/:id
// ═══════════════════════════════════════════════════════════════
/**
 * ⚠️  DEMO ONLY
 * Refunds escrowed funds back to the consumer.
 * Can be called from FUNDED, ASSIGNED, or RESULT_SUBMITTED states.
 */
router.post("/blockchain/refund/:id", protect, async (req, res) => {
  if (!requireBlockchain(res)) return;
  try {
    const dbJob = await loadOwnedJob(req, res);   // P0-1: owner only
    if (!dbJob) return;

    const blockchainJobId = dbJob.blockchainJobId || blockchainService.toBlockchainJobId(dbJob._id);

    const receipt = await blockchainService.refund(blockchainJobId);

    // P0-1: do not leave the job's GPU BUSY once the job has ended.
    await releaseGpuIfHeld(dbJob);

    // Update MongoDB — mark as CANCELLED
    await Job.findByIdAndUpdate(dbJob._id, {
      $set: {
        status: "CANCELLED",
        blockchainTxHash: receipt.txHash,
        completedAt: new Date(),
      },
    });

    // Create Transaction record for refund
    await Transaction.create({
      jobId: dbJob._id,
      type: TX_TYPE.REFUND,
      txHash: receipt.txHash,
      amount: 0,
      status: TX_STATUS.CONFIRMED,
      timestamp: new Date(),
    });

    const onChain = await blockchainService.getJob(blockchainJobId);

    res.json({
      success: true,
      message: "Escrow refunded to consumer on-chain. Job marked CANCELLED.",
      data: {
        mongoJobId: dbJob._id,
        blockchainJobId,
        txHash: receipt.txHash,
        onChain,
        _note: "⚠️  DEMO ONLY — Hardhat test ETH. Zero real-world value.",
      },
    });
  } catch (err) {
    console.error("[Blockchain Route] refund error:", err.message);
    res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;
