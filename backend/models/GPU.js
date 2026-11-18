/**
 * models/GPU.js
 * GPU model — GPU Compute Exchange
 *
 * Represents a GPU registered by a provider.
 *
 * Conceptual example:
 *   { gpuModel: "RTX 4090", gpuMemory: 24, cudaVersion: "12.2",
 *     pricePerHour: 100, availability: true, status: "ACTIVE" }
 *
 * Relationships:
 *   GPU.providerId → User._id   (GPU is owned by a provider)
 *   GPU._id ← Job.gpuId         (GPU is assigned to many jobs over time)
 */

const mongoose = require("mongoose");

// ── Constants ─────────────────────────────────────────────────
const GPU_STATUS = Object.freeze({
  ACTIVE:   "ACTIVE",    // Online and accepting jobs
  INACTIVE: "INACTIVE",  // Offline / provider disabled it
  BUSY:     "BUSY",      // Currently executing a job
});

// ── Schema ────────────────────────────────────────────────────
const gpuSchema = new mongoose.Schema(
  {
    workerKeyHash: { type: String, select: false },
    executionMode: String,
    workerSession: { type: String, select: false },
    capabilities: mongoose.Schema.Types.Mixed,
    lastHeartbeat: Date,
    activeJob: { type: mongoose.Schema.Types.ObjectId, ref: "Job", default: null },
    providerWallet: String,
    providerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: [true, "Provider ID is required"],
    },

    gpuModel: {
      type: String,
      required: [true, "GPU model name is required"],
      trim: true,
      // e.g. "RTX 4090", "A100 80GB", "H100"
    },

    gpuMemory: {
      type: Number,
      required: [true, "GPU memory (GB) is required"],
      min: [0, "Memory cannot be negative"],
      // stored in GB — e.g. 24
    },

    cudaVersion: {
      type: String,
      required: [true, "CUDA version is required"],
      trim: true,
      // e.g. "12.2", "11.8"
    },

    pricePerHour: {
      type: Number,
      required: [true, "Price per hour is required"],
      min: [0, "Price cannot be negative"],
      // stored in smallest currency unit (e.g. paise or USD cents)
      // display/conversion handled by the API layer
    },

    availability: {
      type: Boolean,
      default: true,
      // true  = provider is offering this GPU for hire
      // false = provider has paused / delisted this GPU
    },

    status: {
      type: String,
      enum: {
        values: Object.values(GPU_STATUS),
        message: "GPU status must be ACTIVE, INACTIVE, or BUSY",
      },
      default: GPU_STATUS.ACTIVE,
    },
  },
  {
    timestamps: true,
    versionKey: false,
  }
);

// ── Indexes ───────────────────────────────────────────────────
// Scheduler queries: "find available GPUs for this provider"
gpuSchema.index({ providerId: 1 });

// Marketplace queries: "show all available GPUs"
gpuSchema.index({ availability: 1 });

// Combined: common query pattern for the scheduler
gpuSchema.index({ availability: 1, status: 1 });

// ── Exports ───────────────────────────────────────────────────
const GPU = mongoose.model("GPU", gpuSchema);

module.exports = GPU;
module.exports.GPU_STATUS = GPU_STATUS;
