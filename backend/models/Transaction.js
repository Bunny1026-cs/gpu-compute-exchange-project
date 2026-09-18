/**
 * models/Transaction.js
 * Transaction model — GPU Compute Exchange
 *
 * Records on-chain and off-chain payment events for a job.
 * Full blockchain integration happens in Phase 3.
 * This model is designed to be populated then.
 *
 * Relationships:
 *   Transaction.jobId → Job._id   (every transaction belongs to a job)
 *
 * Type lifecycle for a normal job:
 *   DEPOSIT → ESCROW → PAYMENT_RELEASE
 *                    ↘ REFUND (on failure/cancellation)
 */

const mongoose = require("mongoose");

// ── Constants ─────────────────────────────────────────────────
const TX_TYPE = Object.freeze({
  DEPOSIT:         "DEPOSIT",          // Consumer deposits funds
  ESCROW:          "ESCROW",           // Funds locked in escrow contract
  PAYMENT_RELEASE: "PAYMENT_RELEASE",  // Funds released to provider on completion
  REFUND:          "REFUND",           // Funds returned to consumer on failure/cancel
});

const TX_STATUS = Object.freeze({
  PENDING:   "PENDING",    // Submitted, awaiting on-chain confirmation
  CONFIRMED: "CONFIRMED",  // On-chain transaction confirmed
  FAILED:    "FAILED",     // Transaction reverted or timed out
});

// ── Schema ────────────────────────────────────────────────────
const transactionSchema = new mongoose.Schema(
  {
    jobId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Job",
      required: [true, "Job ID is required"],
    },

    // On-chain transaction hash (set in Phase 3 when blockchain is live)
    // Optional here so records can be created before the tx is broadcast
    txHash: {
      type: String,
      trim: true,
      default: null,
    },

    type: {
      type: String,
      enum: {
        values: Object.values(TX_TYPE),
        message: `Transaction type must be one of: ${Object.values(TX_TYPE).join(", ")}`,
      },
      required: [true, "Transaction type is required"],
    },

    // Amount in smallest currency unit (e.g. paise, wei, cents)
    amount: {
      type: Number,
      required: [true, "Amount is required"],
      min: [0, "Amount cannot be negative"],
    },

    status: {
      type: String,
      enum: {
        values: Object.values(TX_STATUS),
        message: `Transaction status must be one of: ${Object.values(TX_STATUS).join(", ")}`,
      },
      default: TX_STATUS.PENDING,
    },

    // Explicit event timestamp (distinct from Mongoose's createdAt)
    // Useful for on-chain block timestamp alignment in Phase 3
    timestamp: {
      type: Date,
      default: Date.now,
    },
  },
  {
    timestamps: true,   // createdAt + updatedAt (document-level)
    versionKey: false,
  }
);

// ── Indexes ───────────────────────────────────────────────────
// Most common query: "get all transactions for this job"
transactionSchema.index({ jobId: 1 });

// Blockchain reconciliation: lookup by on-chain hash (Phase 3)
transactionSchema.index({ txHash: 1 }, { sparse: true }); // sparse = skip nulls

// ── Exports ───────────────────────────────────────────────────
const Transaction = mongoose.model("Transaction", transactionSchema);

module.exports = Transaction;
module.exports.TX_TYPE = TX_TYPE;
module.exports.TX_STATUS = TX_STATUS;
