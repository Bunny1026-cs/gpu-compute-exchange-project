/**
 * controllers/jobController.js
 * Job resource controller — GPU Compute Exchange
 *
 * Routes:
 *   POST  /api/jobs              (CONSUMER only — creates job, enqueues it → QUEUED)
 *   GET   /api/jobs              (Consumer: own jobs. Provider: jobs on their GPUs)
 *   GET   /api/jobs/:id          (Consumer owner OR provider whose GPU is assigned)
 *   GET   /api/jobs/:id/result   (Return resultHash + ipfsCid — no IPFS fetch yet)
 *
 * Phase 5 changes:
 *   - gpuId is NO LONGER provided by the consumer. It is set by the scheduler.
 *   - Consumer provides requirements in the request body.
 *   - Jobs are created as CREATED then immediately updated to QUEUED.
 *   - consumerId always comes from req.user — never from body.
 */

const Job = require("../models/Job");
const GPU = require("../models/GPU");
const { JOB_STATUS } = require("../models/Job");
const ipfsService = require("../services/ipfsService");

// ── Controllers ───────────────────────────────────────────────

/**
 * createJob
 * POST /api/jobs  —  CONSUMER only
 *
 * Body fields:
 *   taskType    {string}   optional — e.g. "inference", "training"
 *   input       {object}   optional — arbitrary job payload
 *   requirements {object}  optional — scheduler matching criteria:
 *     requiredGpuMemory   {number}  GB
 *     requiredCudaVersion {string}  e.g. "12.0"
 *     maximumPrice        {number}  max ₹/hr
 *     priority            {number}  reserved for future use
 *   price       {number}   required — consumer's declared budget
 */
const createJob = async (req, res) => {
  try {
    const { taskType, input, requirements, price } = req.body;

    // ── Validation ─────────────────────────────────────────────
    if (price === undefined || price === null) {
      return res.status(400).json({ success: false, message: "price is required." });
    }
    if (Number(price) < 0) {
      return res.status(400).json({ success: false, message: "price cannot be negative." });
    }

    // Validate requirements if provided
    if (requirements !== undefined && requirements !== null) {
      if (typeof requirements !== "object" || Array.isArray(requirements)) {
        return res.status(400).json({ success: false, message: "requirements must be an object." });
      }
      if (requirements.requiredGpuMemory !== undefined && Number(requirements.requiredGpuMemory) < 0) {
        return res.status(400).json({ success: false, message: "requiredGpuMemory cannot be negative." });
      }
      if (requirements.maximumPrice !== undefined && Number(requirements.maximumPrice) < 0) {
        return res.status(400).json({ success: false, message: "maximumPrice cannot be negative." });
      }
    }

    // ── Build input payload ────────────────────────────────────
    // Merge consumer's input data with requirements into the input field.
    // Structure: { ...input, requirements: { ... } }
    const jobInput = {
      ...(input && typeof input === "object" ? input : (input ? { data: input } : {})),
      ...(requirements ? { requirements } : {}),
    };

    // ── Create job (CREATED) then queue it (QUEUED) ────────────
    // Two-step to clearly show the transition in the lifecycle.
    const job = await Job.create({
      consumerId: req.user._id,
      gpuId: null,              // Will be set by the scheduler on assignment
      taskType: taskType ? taskType.trim() : undefined,
      input: Object.keys(jobInput).length > 0 ? jobInput : null,
      price: Number(price),
      status: JOB_STATUS.CREATED,
    });

    // Immediately transition to QUEUED
    job.status = JOB_STATUS.QUEUED;
    await job.save();

    const populated = await job.populate([
      { path: "consumerId", select: "name email" },
    ]);

    return res.status(201).json({
      success: true,
      data: populated,
      message: "Job created and queued. The scheduler will assign a GPU shortly.",
    });
  } catch (err) {
    if (err.name === "ValidationError") {
      const messages = Object.values(err.errors).map((e) => e.message);
      return res.status(400).json({ success: false, message: messages.join(" ") });
    }
    console.error("createJob error:", err.message);
    return res.status(500).json({ success: false, message: "Server error creating job." });
  }
};

/**
 * listJobs
 * GET /api/jobs
 * Consumer: sees own jobs.
 * Provider: sees jobs where the GPU belongs to them.
 */
const listJobs = async (req, res) => {
  try {
    let jobs;

    if (req.user.role === "CONSUMER") {
      // Consumer: own jobs only
      jobs = await Job.find({ consumerId: req.user._id })
        .populate("gpuId", "gpuModel gpuMemory cudaVersion pricePerHour")
        .sort({ createdAt: -1 });
    } else {
      // Provider: find all their GPUs first, then jobs assigned to those GPUs
      const providerGpus = await GPU.find({ providerId: req.user._id }).select("_id");
      const gpuIds = providerGpus.map((g) => g._id);

      jobs = await Job.find({ gpuId: { $in: gpuIds } })
        .populate("consumerId", "name email")
        .populate("gpuId", "gpuModel gpuMemory cudaVersion pricePerHour")
        .sort({ createdAt: -1 });
    }

    return res.status(200).json({ success: true, count: jobs.length, data: jobs });
  } catch (err) {
    console.error("listJobs error:", err.message);
    return res.status(500).json({ success: false, message: "Server error fetching jobs." });
  }
};

/**
 * getJob
 * GET /api/jobs/:id
 * Accessible by:
 *   - Consumer who owns the job
 *   - Provider who owns the GPU assigned to the job (after ASSIGNED)
 */
const getJob = async (req, res) => {
  try {
    const job = await Job.findById(req.params.id)
      .populate("consumerId", "name email")
      .populate("gpuId", "gpuModel gpuMemory cudaVersion pricePerHour providerId");

    if (!job) {
      return res.status(404).json({ success: false, message: "Job not found." });
    }

    // ── Authorization check ────────────────────────────────────
    const userId = req.user._id.toString();
    const isConsumerOwner = job.consumerId._id.toString() === userId;
    const isAssignedProvider =
      req.user.role === "PROVIDER" &&
      job.gpuId &&
      job.gpuId.providerId &&
      job.gpuId.providerId.toString() === userId;

    if (!isConsumerOwner && !isAssignedProvider) {
      return res.status(403).json({
        success: false,
        message: "Access denied. You are not authorized to view this job.",
      });
    }

    return res.status(200).json({ success: true, data: job });
  } catch (err) {
    if (err.name === "CastError") {
      return res.status(400).json({ success: false, message: "Invalid job ID format." });
    }
    console.error("getJob error:", err.message);
    return res.status(500).json({ success: false, message: "Server error fetching job." });
  }
};

/**
 * getJobResult
 * GET /api/jobs/:id/result
 * Returns result fields and, when available, the stored result content.
 */
const getJobResult = async (req, res) => {
  try {
    const job = await Job.findById(req.params.id)
      .populate("gpuId", "providerId");

    if (!job) {
      return res.status(404).json({ success: false, message: "Job not found." });
    }

    // ── Authorization check (same as getJob) ───────────────────
    const userId = req.user._id.toString();
    const isConsumerOwner = job.consumerId.toString() === userId;
    const isAssignedProvider =
      req.user.role === "PROVIDER" &&
      job.gpuId &&
      job.gpuId.providerId &&
      job.gpuId.providerId.toString() === userId;

    if (!isConsumerOwner && !isAssignedProvider) {
      return res.status(403).json({
        success: false,
        message: "Access denied. You are not authorized to view this job's result.",
      });
    }

    // ── Retrieve result content when it is locally available ───
    // Retrieval failure must not hide the job metadata: a CID can point to a
    // remote gateway that is temporarily unavailable.
    let result = null;
    if (job.ipfsCid && ipfsService.isAvailable()) {
      const stored = await ipfsService.retrieve(job.ipfsCid);
      if (stored) {
        try {
          result = JSON.parse(stored.content);
        } catch (_) {
          result = stored.content;
        }
      }
    }

    // ── Return result info ─────────────────────────────────────
    return res.status(200).json({
      success: true,
      data: {
        jobId: job._id,
        status: job.status,
        resultHash: job.resultHash,
        ipfsCid: job.ipfsCid,
        result,
        completedAt: job.completedAt,
        note:
          !job.resultHash && !job.ipfsCid
            ? "No result available yet. Job status: " + job.status
            : "Result available.",
      },
    });
  } catch (err) {
    if (err.name === "CastError") {
      return res.status(400).json({ success: false, message: "Invalid job ID format." });
    }
    console.error("getJobResult error:", err.message);
    return res.status(500).json({ success: false, message: "Server error fetching job result." });
  }
};

module.exports = { createJob, listJobs, getJob, getJobResult };
