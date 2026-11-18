/**
 * models/Job.js
 * GPU Compute Exchange — Job model
 *
 * Represents a compute job submitted by a consumer.
 * Tracks the full lifecycle from submission to result retrieval.
 *
 * Relationships:
 *   Job.consumerId → User._id   (job submitted by a consumer)
 *   Job.gpuId      → GPU._id    (GPU assigned by the scheduler — set after QUEUED)
 *   Job._id ← Transaction.jobId (payment transactions for this job)
 *
 * Application status lifecycle (MongoDB):
 *   CREATED → QUEUED → ASSIGNED → RUNNING → RESULT_UPLOADED → COMPLETED
 *                                                            ↘ FAILED
 *                                          ↘ CANCELLED (any time before RUNNING)
 *
 * Blockchain status lifecycle (GPUComputeEscrow contract — Phase 7):
 *   REGISTERED → FUNDED → ASSIGNED → RESULT_SUBMITTED → VERIFIED → COMPLETED
 *                                                                  ↘ REFUNDED
 *
 * Relationship:
 *   MongoDB QUEUED     ≈ Blockchain REGISTERED + FUNDED  (demo escrow)
 *   MongoDB ASSIGNED   ≈ Blockchain ASSIGNED
 *   MongoDB COMPLETED  ≈ Blockchain COMPLETED
 *   MongoDB CANCELLED  ≈ Blockchain REFUNDED
 *
 * Phase 7 — Blockchain Integration:
 *   - blockchainJobId: deterministic bytes32 mapped from MongoDB ObjectId
 *   - blockchainTxHash: last blockchain tx hash relevant to this job
 *   - escrowAmountWei: demo test ETH amount in wei (SEPARATE from app price in ₹)
 *
 * IMPORTANT: escrowAmountWei is DEMO-ONLY local Hardhat test ETH.
 *   It has ZERO real-world value. Do NOT confuse with pricePerHour (₹).
 */

const mongoose = require("mongoose");

// ── Constants ─────────────────────────────────────────────────
const JOB_STATUS = Object.freeze({
  AWAITING_FUNDING: "AWAITING_FUNDING",
  SETTLEMENT_PENDING: "SETTLEMENT_PENDING",
  REFUND_PENDING: "REFUND_PENDING",
  REFUNDED: "REFUNDED",
  CREATED:         "CREATED",          // Job record created, not yet in queue
  QUEUED:          "QUEUED",           // Added to the job queue, awaiting scheduler
  ASSIGNED:        "ASSIGNED",         // Scheduler assigned a specific GPU
  RUNNING:         "RUNNING",          // Worker is actively executing
  RESULT_UPLOADED: "RESULT_UPLOADED",  // Worker pushed result to IPFS (Phase 6)
  COMPLETED:       "COMPLETED",        // Consumer acknowledged, payment released
  FAILED:          "FAILED",           // Execution error
  CANCELLED:       "CANCELLED",        // Cancelled before execution
});

// ── Schema ────────────────────────────────────────────────────
const jobSchema = new mongoose.Schema(
  {
    protocol: { type: String, default: "legacy" },
    spec: { type: mongoose.Schema.Types.Mixed, immutable: true },
    specHash: { type: String, immutable: true },
    rateWeiPerMinute: String,
    reservedMinutes: Number,
    chainInstance: String,
    providerWallet: String,
    leaseId: String,
    leaseExpiresAt: Date,
    startedAt: Date,
    assignedAt: Date,
    fundedAt: Date,
    queueClockId: String,
    queueStartMs: Number,
    queueWaitMs: Number,
    schedulingMs: Number,
    receiveMs: Number,
    error: String,
    artifactPath: { type: String, select: false },
    resultMetadata: mongoose.Schema.Types.Mixed,
    verification: mongoose.Schema.Types.Mixed,
    paymentWei: String,
    receipts: { type: [mongoose.Schema.Types.Mixed], default: [] },
    lockToken: { type: String, select: false },
    lockUntil: { type: Date, select: false },
    consumerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: [true, "Consumer ID is required"],
    },

    // Set by the scheduler when a compatible GPU is found and assigned.
    // NOT provided by the consumer at submission time.
    // null until status transitions from QUEUED → ASSIGNED.
    gpuId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "GPU",
      default: null,
    },

    status: {
      type: String,
      enum: {
        values: Object.values(JOB_STATUS),
        message: `Job status must be one of: ${Object.values(JOB_STATUS).join(", ")}`,
      },
      default: JOB_STATUS.CREATED,
    },

    taskType: {
      type: String,
      trim: true,
      // e.g. "inference", "training", "fine-tuning", "render"
      // Not an enum here — kept open for extensibility
    },

    // Arbitrary job payload: script path, model name, hyperparams, etc.
    // Stored as Mixed (any JSON-serialisable value).
    // Phase 4 will define a stricter schema per taskType.
    input: {
      type: mongoose.Schema.Types.Mixed,
      default: null,
    },

    // SHA-256 or similar hash of the result artifact (set by worker — Phase 4)
    resultHash: {
      type: String,
      default: null,
    },

    // IPFS Content Identifier of the result (set by worker — Phase 6)
    ipfsCid: {
      type: String,
      default: null,
    },

    // Price agreed at job submission (in application currency — ₹ for display)
    // This is the MARKETPLACE price. It is NOT the blockchain escrow amount.
    price: {
      type: Number,
      required: [true, "Job price is required"],
      min: [0, "Price cannot be negative"],
    },

    // ── Blockchain fields (Phase 7) ─────────────────────────
    // All blockchain fields are null until the job is registered on-chain.

    // Deterministic bytes32 hex identifier for this job on the contract.
    // Derived from MongoDB _id via toBlockchainJobId().
    // Format: 0x<64 hex chars> (zero-padded MongoDB ObjectId)
    blockchainJobId: {
      type: String,
      default: null,
    },

    // Transaction hash of the most recent blockchain operation for this job.
    // Updated by the scheduler on assignJob(), and by operator functions.
    blockchainTxHash: {
      type: String,
      default: null,
    },

    // ⚠️  DEMO ESCROW — LOCAL HARDHAT ONLY, ZERO REAL VALUE
    // Amount in wei deposited into the GPUComputeEscrow contract.
    // Stored as a String to avoid JavaScript BigInt precision issues.
    // This is SEPARATE from the application price (₹). No exchange rate.
    // Set only when BLOCKCHAIN_DEMO_MODE=true and escrow is deposited.
    escrowAmountWei: {
      type: String,
      default: null,
    },

    // Set when job reaches COMPLETED or FAILED
    completedAt: {
      type: Date,
      default: null,
    },
  },
  {
    timestamps: true,   // createdAt + updatedAt
    versionKey: false,
  }
);

// ── Indexes ───────────────────────────────────────────────────
// Consumer dashboard: "show all my jobs"
jobSchema.index({ consumerId: 1 });

// Scheduler: "find jobs assigned to this GPU"
jobSchema.index({ gpuId: 1 });

// Queue/scheduler queries: "find all QUEUED jobs"
jobSchema.index({ status: 1 });

// Combined: consumer filtered by status (common dashboard query)
jobSchema.index({ consumerId: 1, status: 1 });

// ── Exports ───────────────────────────────────────────────────
const Job = mongoose.model("Job", jobSchema);

module.exports = Job;
module.exports.JOB_STATUS = JOB_STATUS;
