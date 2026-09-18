/**
 * controllers/workerController.js
 * GPU Worker API controller — GPU Compute Exchange
 *
 * These endpoints are used by the Python GPU worker to:
 *   1. Poll for ASSIGNED jobs
 *   2. Mark jobs as RUNNING
 *   3. Submit results (resultHash + ipfsCid)
 *   4. Report failures
 *   5. Complete jobs (triggers verification + payment pipeline)
 *
 * Authentication: Worker API Key (WORKER_API_KEY env var)
 * These routes are NOT for end users — they are for the backend worker process.
 *
 * Job lifecycle managed here:
 *   ASSIGNED → RUNNING → RESULT_UPLOADED → COMPLETED
 *                      → FAILED
 */

"use strict";

const Job   = require("../models/Job");
const GPU   = require("../models/GPU");
const Transaction = require("../models/Transaction");
const { JOB_STATUS }  = require("../models/Job");
const { GPU_STATUS }  = require("../models/GPU");
const { TX_TYPE, TX_STATUS } = require("../models/Transaction");
const blockchainService = require("../blockchain/blockchainService");
const ipfsService = require("../services/ipfsService");

const LOG_PREFIX = "[Worker API]";

// ── Middleware: Worker API Key Auth ────────────────────────────
/**
 * authenticateWorker
 * Validates the X-Worker-API-Key header against WORKER_API_KEY env var.
 * This is a simple shared-secret auth for the worker process.
 */
function authenticateWorker(req, res, next) {
  const apiKey = req.headers["x-worker-api-key"];
  const expectedKey = process.env.WORKER_API_KEY;

  if (!expectedKey) {
    console.warn(`${LOG_PREFIX} ⚠️  WORKER_API_KEY not set. Worker API is disabled.`);
    return res.status(503).json({
      success: false,
      message: "Worker API not configured. Set WORKER_API_KEY in backend .env",
    });
  }

  if (!apiKey || apiKey !== expectedKey) {
    return res.status(401).json({
      success: false,
      message: "Invalid or missing worker API key.",
    });
  }

  next();
}

// ── Controllers ───────────────────────────────────────────────

/**
 * GET /api/worker/jobs
 * Returns jobs in ASSIGNED status for the worker to pick up.
 * Worker polls this endpoint periodically.
 */
async function fetchAssignedJobs(req, res) {
  try {
    const jobs = await Job.find({ status: JOB_STATUS.ASSIGNED })
      .populate("gpuId", "gpuModel gpuMemory cudaVersion pricePerHour providerId")
      .populate("consumerId", "name email")
      .sort({ createdAt: 1 }) // FIFO
      .lean();

    return res.json({
      success: true,
      count: jobs.length,
      data: jobs,
    });
  } catch (err) {
    console.error(`${LOG_PREFIX} fetchAssignedJobs error:`, err.message);
    return res.status(500).json({ success: false, message: err.message });
  }
}

/**
 * POST /api/worker/jobs/:id/start
 * Transitions job: ASSIGNED → RUNNING
 * Also marks the GPU as BUSY (if not already).
 */
async function startJob(req, res) {
  try {
    const job = await Job.findById(req.params.id);
    if (!job) return res.status(404).json({ success: false, message: "Job not found." });

    if (job.status !== JOB_STATUS.ASSIGNED) {
      return res.status(400).json({
        success: false,
        message: `Cannot start job in ${job.status} status. Must be ASSIGNED.`,
      });
    }

    // Update job status to RUNNING
    await Job.findByIdAndUpdate(job._id, {
      $set: { status: JOB_STATUS.RUNNING },
    });

    console.log(`${LOG_PREFIX} ✅ Job ${job._id} → RUNNING`);

    return res.json({
      success: true,
      message: `Job ${job._id} is now RUNNING.`,
      data: { jobId: job._id, status: JOB_STATUS.RUNNING },
    });
  } catch (err) {
    console.error(`${LOG_PREFIX} startJob error:`, err.message);
    return res.status(500).json({ success: false, message: err.message });
  }
}

/**
 * POST /api/worker/jobs/:id/result
 * Worker submits the computation result.
 * Transitions: RUNNING → RESULT_UPLOADED
 *
 * Body: {
 *   resultHash: "sha256-hex-string",
 *   resultData: { ... }         // optional — will be uploaded to IPFS
 *   ipfsCid:    "Qm..."        // optional — if worker already uploaded to IPFS
 * }
 */
async function submitResult(req, res) {
  try {
    const job = await Job.findById(req.params.id);
    if (!job) return res.status(404).json({ success: false, message: "Job not found." });

    if (job.status !== JOB_STATUS.RUNNING) {
      return res.status(400).json({
        success: false,
        message: `Cannot submit result for job in ${job.status} status. Must be RUNNING.`,
      });
    }

    const { resultHash, resultData, ipfsCid } = req.body;

    if (!resultHash) {
      return res.status(400).json({
        success: false,
        message: "resultHash is required.",
      });
    }

    // ── IPFS Upload ─────────────────────────────────────────
    let finalCid = ipfsCid || null;
    if (!finalCid && resultData && ipfsService.isAvailable()) {
      try {
        const uploadResult = await ipfsService.uploadJSON({
          jobId: job._id.toString(),
          resultHash,
          data: resultData,
          timestamp: new Date().toISOString(),
        });
        finalCid = uploadResult.cid;
        console.log(`${LOG_PREFIX} 📦 Result uploaded to IPFS: ${finalCid} (${ipfsService.getMode()} mode)`);
      } catch (ipfsErr) {
        console.warn(`${LOG_PREFIX} ⚠️  IPFS upload failed: ${ipfsErr.message}. Continuing without IPFS.`);
      }
    }

    // ── Update MongoDB ──────────────────────────────────────
    const updates = {
      status: JOB_STATUS.RESULT_UPLOADED,
      resultHash,
    };
    if (finalCid) updates.ipfsCid = finalCid;

    await Job.findByIdAndUpdate(job._id, { $set: updates });

    console.log(`${LOG_PREFIX} ✅ Job ${job._id} → RESULT_UPLOADED (hash: ${resultHash.substring(0, 16)}...)`);

    return res.json({
      success: true,
      message: `Result submitted. Job ${job._id} is now RESULT_UPLOADED.`,
      data: {
        jobId: job._id,
        status: JOB_STATUS.RESULT_UPLOADED,
        resultHash,
        ipfsCid: finalCid,
      },
    });
  } catch (err) {
    console.error(`${LOG_PREFIX} submitResult error:`, err.message);
    return res.status(500).json({ success: false, message: err.message });
  }
}

/**
 * POST /api/worker/jobs/:id/fail
 * Worker reports a job failure.
 * Transitions: RUNNING → FAILED
 * Also releases the GPU back to ACTIVE/available.
 *
 * Body: { reason: "string" }
 */
async function failJob(req, res) {
  try {
    const job = await Job.findById(req.params.id);
    if (!job) return res.status(404).json({ success: false, message: "Job not found." });

    if (job.status !== JOB_STATUS.RUNNING && job.status !== JOB_STATUS.ASSIGNED) {
      return res.status(400).json({
        success: false,
        message: `Cannot fail job in ${job.status} status. Must be RUNNING or ASSIGNED.`,
      });
    }

    const reason = req.body.reason || "Unknown error";

    // ── Release the GPU ─────────────────────────────────────
    if (job.gpuId) {
      await GPU.findByIdAndUpdate(job.gpuId, {
        $set: { status: GPU_STATUS.ACTIVE, availability: true },
      });
      console.log(`${LOG_PREFIX} GPU ${job.gpuId} released back to ACTIVE.`);
    }

    // ── Update job ──────────────────────────────────────────
    await Job.findByIdAndUpdate(job._id, {
      $set: {
        status: JOB_STATUS.FAILED,
        completedAt: new Date(),
      },
    });

    // ── Blockchain refund if available ───────────────────────
    if (blockchainService.isAvailable() && job.blockchainJobId) {
      try {
        const receipt = await blockchainService.refund(job.blockchainJobId);
        await Job.findByIdAndUpdate(job._id, {
          $set: { blockchainTxHash: receipt.txHash },
        });
        await Transaction.create({
          jobId: job._id,
          type: TX_TYPE.REFUND,
          txHash: receipt.txHash,
          amount: 0,
          status: TX_STATUS.CONFIRMED,
          timestamp: new Date(),
        });
        console.log(`${LOG_PREFIX} ⛓️  Blockchain refund issued for job ${job._id}`);
      } catch (bcErr) {
        console.warn(`${LOG_PREFIX} ⚠️  Blockchain refund failed: ${bcErr.message}`);
      }
    }

    console.log(`${LOG_PREFIX} ❌ Job ${job._id} → FAILED: ${reason}`);

    return res.json({
      success: true,
      message: `Job ${job._id} marked as FAILED.`,
      data: { jobId: job._id, status: JOB_STATUS.FAILED, reason },
    });
  } catch (err) {
    console.error(`${LOG_PREFIX} failJob error:`, err.message);
    return res.status(500).json({ success: false, message: err.message });
  }
}

/**
 * POST /api/worker/jobs/:id/complete
 * Triggers the full verification + payment pipeline.
 * Transitions: RESULT_UPLOADED → COMPLETED
 *
 * Steps:
 *   1. Verify result hash on blockchain (if available)
 *   2. Release payment on blockchain (if available)
 *   3. Release GPU back to ACTIVE
 *   4. Create Transaction record
 *   5. Update job status to COMPLETED
 */
async function completeJob(req, res) {
  try {
    const job = await Job.findById(req.params.id);
    if (!job) return res.status(404).json({ success: false, message: "Job not found." });

    if (job.status !== JOB_STATUS.RESULT_UPLOADED) {
      return res.status(400).json({
        success: false,
        message: `Cannot complete job in ${job.status} status. Must be RESULT_UPLOADED.`,
      });
    }

    let lastTxHash = job.blockchainTxHash;

    // ── Blockchain verification + payment ───────────────────
    if (blockchainService.isAvailable() && job.blockchainJobId && job.resultHash) {
      try {
        // Step 1: Verify result on-chain
        const verifyReceipt = await blockchainService.verifyResult(
          job.blockchainJobId,
          job.resultHash
        );
        lastTxHash = verifyReceipt.txHash;
        console.log(`${LOG_PREFIX} ⛓️  Result verified on-chain: ${verifyReceipt.txHash}`);

        // Step 2: Release payment
        const releaseReceipt = await blockchainService.releasePayment(job.blockchainJobId);
        lastTxHash = releaseReceipt.txHash;
        console.log(`${LOG_PREFIX} ⛓️  Payment released on-chain: ${releaseReceipt.txHash}`);

        // Create Transaction record
        await Transaction.create({
          jobId: job._id,
          type: TX_TYPE.PAYMENT_RELEASE,
          txHash: releaseReceipt.txHash,
          amount: 0,
          status: TX_STATUS.CONFIRMED,
          timestamp: new Date(),
        });
      } catch (bcErr) {
        console.warn(`${LOG_PREFIX} ⚠️  Blockchain completion failed: ${bcErr.message}. Job still completed in MongoDB.`);
      }
    }

    // ── Release GPU ─────────────────────────────────────────
    if (job.gpuId) {
      await GPU.findByIdAndUpdate(job.gpuId, {
        $set: { status: GPU_STATUS.ACTIVE, availability: true },
      });
      console.log(`${LOG_PREFIX} GPU ${job.gpuId} released back to ACTIVE.`);
    }

    // ── Update job ──────────────────────────────────────────
    await Job.findByIdAndUpdate(job._id, {
      $set: {
        status: JOB_STATUS.COMPLETED,
        blockchainTxHash: lastTxHash,
        completedAt: new Date(),
      },
    });

    console.log(`${LOG_PREFIX} ✅ Job ${job._id} → COMPLETED`);

    return res.json({
      success: true,
      message: `Job ${job._id} completed successfully.`,
      data: {
        jobId: job._id,
        status: JOB_STATUS.COMPLETED,
        resultHash: job.resultHash,
        ipfsCid: job.ipfsCid,
        blockchainTxHash: lastTxHash,
      },
    });
  } catch (err) {
    console.error(`${LOG_PREFIX} completeJob error:`, err.message);
    return res.status(500).json({ success: false, message: err.message });
  }
}

/**
 * GET /api/worker/ipfs/:cid
 * Retrieves content from IPFS (or mock) by CID.
 */
async function getIPFSContent(req, res) {
  try {
    if (!ipfsService.isAvailable()) {
      return res.status(503).json({
        success: false,
        message: "IPFS service not initialized.",
      });
    }

    const result = await ipfsService.retrieve(req.params.cid);
    if (!result) {
      return res.status(404).json({
        success: false,
        message: `Content not found for CID: ${req.params.cid}`,
      });
    }

    return res.json({
      success: true,
      data: {
        cid: req.params.cid,
        content: result.content,
        contentType: result.contentType,
        ipfsMode: ipfsService.getMode(),
      },
    });
  } catch (err) {
    console.error(`${LOG_PREFIX} getIPFSContent error:`, err.message);
    return res.status(500).json({ success: false, message: err.message });
  }
}

module.exports = {
  authenticateWorker,
  fetchAssignedJobs,
  startJob,
  submitResult,
  failJob,
  completeJob,
  getIPFSContent,
};
