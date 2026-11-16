/**
 * controllers/gpuController.js
 * GPU resource controller — GPU Compute Exchange
 *
 * Routes:
 *   POST   /api/gpus          (PROVIDER only — create)
 *   GET    /api/gpus          (public/authenticated — marketplace list)
 *   GET    /api/gpus/:id      (authenticated — single GPU)
 *   PUT    /api/gpus/:id      (PROVIDER — own GPU only)
 *   DELETE /api/gpus/:id      (PROVIDER — own GPU only)
 *
 * Security: providerId always comes from req.user — never from the request body.
 */

const GPU = require("../models/GPU");
const { GPU_STATUS } = require("../models/GPU");
const { parseCuda } = require("../scheduler/matcher");
const CUDA_FORMAT_MSG = "cudaVersion must look like 12, 12.2 or 12.2.1.";

// ── Helpers ───────────────────────────────────────────────────

/** Fields a provider is allowed to update */
const UPDATABLE_FIELDS = ["gpuModel", "gpuMemory", "cudaVersion", "pricePerHour", "availability", "status"];

// P0-4: BUSY is owned by the scheduler/worker lifecycle. Providers may not set
// it, and may not change status/availability while a GPU is BUSY.
const SCHEDULER_MANAGED_FIELDS = ["status", "availability"];
const BUSY_NOT_SETTABLE_MSG =
  "GPU status BUSY is managed by the scheduler and cannot be set manually. Use ACTIVE or INACTIVE.";
const BUSY_LOCKED_MSG =
  "This GPU is BUSY with an assigned or running job. Its status and availability cannot be changed until the job ends.";

/**
 * extractUpdateFields
 * Picks only allowed fields from the request body.
 * Ignores providerId, _id etc. — server always controls those.
 */
const extractUpdateFields = (body) => {
  const update = {};
  UPDATABLE_FIELDS.forEach((field) => {
    if (body[field] !== undefined) update[field] = body[field];
  });
  return update;
};

// ── Controllers ───────────────────────────────────────────────

/**
 * createGPU
 * POST /api/gpus  —  PROVIDER only
 */
const createGPU = async (req, res) => {
  try {
    const { gpuModel, gpuMemory, cudaVersion, pricePerHour, availability, status } = req.body;

    // ── Validation ─────────────────────────────────────────────
    if (!gpuModel || !gpuModel.trim()) {
      return res.status(400).json({ success: false, message: "gpuModel is required." });
    }
    if (gpuMemory === undefined || gpuMemory === null) {
      return res.status(400).json({ success: false, message: "gpuMemory (GB) is required." });
    }
    if (!cudaVersion || !cudaVersion.trim()) {
      return res.status(400).json({ success: false, message: "cudaVersion is required." });
    }
    if (pricePerHour === undefined || pricePerHour === null) {
      return res.status(400).json({ success: false, message: "pricePerHour is required." });
    }
    if (status === GPU_STATUS.BUSY) {
      return res.status(400).json({ success: false, message: BUSY_NOT_SETTABLE_MSG });
    }
    if (!parseCuda(cudaVersion)) {                                    // P1-1
      return res.status(400).json({ success: false, message: CUDA_FORMAT_MSG });
    }

    // ── providerId comes from auth — never from body ───────────
    const gpu = await GPU.create({
      providerId: req.user._id,
      gpuModel: gpuModel.trim(),
      gpuMemory: Number(gpuMemory),
      cudaVersion: cudaVersion.trim(),
      pricePerHour: Number(pricePerHour),
      availability: availability !== undefined ? availability : true,
      status: status || "ACTIVE",
    });

    return res.status(201).json({ success: true, data: gpu });
  } catch (err) {
    if (err.name === "ValidationError") {
      const messages = Object.values(err.errors).map((e) => e.message);
      return res.status(400).json({ success: false, message: messages.join(" ") });
    }
    console.error("createGPU error:", err.message);
    return res.status(500).json({ success: false, message: "Server error creating GPU." });
  }
};

/**
 * listGPUs
 * GET /api/gpus
 * Marketplace view — returns available GPUs.
 * Optional query: ?providerId=<id> to see a specific provider's GPUs.
 */
const listGPUs = async (req, res) => {
  try {
    const filter = {};

    // Providers can view their own GPUs (including unavailable ones)
    if (req.query.mine === "true" && req.user && req.user.role === "PROVIDER") {
      filter.providerId = req.user._id;
    } else {
      // Default marketplace view — only available GPUs
      filter.availability = true;
    }

    const gpus = await GPU.find(filter)
      .populate("providerId", "name email")
      .sort({ createdAt: -1 });

    return res.status(200).json({ success: true, count: gpus.length, data: gpus });
  } catch (err) {
    console.error("listGPUs error:", err.message);
    return res.status(500).json({ success: false, message: "Server error fetching GPUs." });
  }
};

/**
 * getGPU
 * GET /api/gpus/:id
 */
const getGPU = async (req, res) => {
  try {
    const gpu = await GPU.findById(req.params.id).populate("providerId", "name email");

    if (!gpu) {
      return res.status(404).json({ success: false, message: "GPU not found." });
    }

    return res.status(200).json({ success: true, data: gpu });
  } catch (err) {
    if (err.name === "CastError") {
      return res.status(400).json({ success: false, message: "Invalid GPU ID format." });
    }
    console.error("getGPU error:", err.message);
    return res.status(500).json({ success: false, message: "Server error fetching GPU." });
  }
};

/**
 * updateGPU
 * PUT /api/gpus/:id  —  PROVIDER — own GPU only
 */
const updateGPU = async (req, res) => {
  try {
    const gpu = await GPU.findById(req.params.id);

    if (!gpu) {
      return res.status(404).json({ success: false, message: "GPU not found." });
    }

    // ── Ownership check ────────────────────────────────────────
    if (gpu.providerId.toString() !== req.user._id.toString()) {
      return res.status(403).json({
        success: false,
        message: "Access denied. You can only modify your own GPUs.",
      });
    }

    // ── Apply only whitelisted fields ──────────────────────────
    const updates = extractUpdateFields(req.body);

    if (Object.keys(updates).length === 0) {
      return res.status(400).json({
        success: false,
        message: `No valid fields to update. Allowed: ${UPDATABLE_FIELDS.join(", ")}.`,
      });
    }

    if (updates.status === GPU_STATUS.BUSY) {
      return res.status(400).json({ success: false, message: BUSY_NOT_SETTABLE_MSG });
    }
    if (updates.cudaVersion !== undefined && !parseCuda(updates.cudaVersion)) {   // P1-1
      return res.status(400).json({ success: false, message: CUDA_FORMAT_MSG });
    }

    const touchesManagedField = SCHEDULER_MANAGED_FIELDS.some((f) => f in updates);
    if (touchesManagedField && gpu.status === GPU_STATUS.BUSY) {
      return res.status(409).json({ success: false, message: BUSY_LOCKED_MSG });
    }

    // P0-4: when status/availability change, the write is conditional on the
    // GPU not being BUSY at write time, closing the gap between the read
    // above and a concurrent scheduler claim.
    const filter = { _id: req.params.id, providerId: req.user._id };
    if (touchesManagedField) filter.status = { $ne: GPU_STATUS.BUSY };

    const updated = await GPU.findOneAndUpdate(
      filter,
      { $set: updates },
      { returnDocument: "after", runValidators: true }
    );

    if (!updated) {
      return res.status(409).json({ success: false, message: BUSY_LOCKED_MSG });
    }

    return res.status(200).json({ success: true, data: updated });
  } catch (err) {
    if (err.name === "CastError") {
      return res.status(400).json({ success: false, message: "Invalid GPU ID format." });
    }
    if (err.name === "ValidationError") {
      const messages = Object.values(err.errors).map((e) => e.message);
      return res.status(400).json({ success: false, message: messages.join(" ") });
    }
    console.error("updateGPU error:", err.message);
    return res.status(500).json({ success: false, message: "Server error updating GPU." });
  }
};

/**
 * deleteGPU
 * DELETE /api/gpus/:id  —  PROVIDER — own GPU only
 */
const deleteGPU = async (req, res) => {
  try {
    const gpu = await GPU.findById(req.params.id);

    if (!gpu) {
      return res.status(404).json({ success: false, message: "GPU not found." });
    }

    // ── Ownership check ────────────────────────────────────────
    if (gpu.providerId.toString() !== req.user._id.toString()) {
      return res.status(403).json({
        success: false,
        message: "Access denied. You can only delete your own GPUs.",
      });
    }

    if (gpu.status === GPU_STATUS.BUSY) {
      return res.status(409).json({
        success: false,
        message: "A GPU with an assigned or running job cannot be deleted.",
      });
    }

    // P0-4: atomic delete — succeeds only if the GPU is (still) not BUSY,
    // so a scheduler claim between the check above and this write is safe.
    const deleted = await GPU.findOneAndDelete({
      _id: req.params.id,
      providerId: req.user._id,
      status: { $ne: GPU_STATUS.BUSY },
    });

    if (!deleted) {
      return res.status(409).json({
        success: false,
        message: "A GPU with an assigned or running job cannot be deleted.",
      });
    }

    return res.status(200).json({ success: true, message: "GPU deleted successfully." });
  } catch (err) {
    if (err.name === "CastError") {
      return res.status(400).json({ success: false, message: "Invalid GPU ID format." });
    }
    console.error("deleteGPU error:", err.message);
    return res.status(500).json({ success: false, message: "Server error deleting GPU." });
  }
};

module.exports = { createGPU, listGPUs, getGPU, updateGPU, deleteGPU };
