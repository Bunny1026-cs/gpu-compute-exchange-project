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

// ── Helpers ───────────────────────────────────────────────────

/** Fields a provider is allowed to update */
const UPDATABLE_FIELDS = ["gpuModel", "gpuMemory", "cudaVersion", "pricePerHour", "availability", "status"];

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

    const updated = await GPU.findByIdAndUpdate(
      req.params.id,
      { $set: updates },
      { returnDocument: "after", runValidators: true }
    );

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

    await GPU.findByIdAndDelete(req.params.id);

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
