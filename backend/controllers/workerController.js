/**
 * controllers/workerController.js
 * GPU Worker API controller — GPU Compute Exchange
 *
 * These endpoints are used by the Python GPU worker to:
 *   1. Poll for ASSIGNED jobs
 *   2. Mark jobs as RUNNING
 *   3. Submit results (resultHash + resultData; the backend assigns the CID)
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

/**
 * transition (P1-2)
 * Atomically moves a job from one of `fromStatuses` to a new state.
 * Returns { job } on success (the PRE-transition document fields we need are
 * re-read from the returned post-update document), or { error } with the
 * same HTTP status/message the endpoints used before:
 *   404 if the job does not exist, 400 if it is in another state.
 * Because the status condition is part of the write, two concurrent callers
 * can never both succeed.
 */
async function transition(jobId, fromStatuses, set, label) {
  const updated = await Job.findOneAndUpdate(
    { _id: jobId, status: { $in: fromStatuses } },
    { $set: set },
    { returnDocument: "after" }
  );
  if (updated) return { job: updated };
  const current = await Job.findById(jobId).select("status");
  if (!current) return { error: { code: 404, message: "Job not found." } };
  return { error: { code: 400, message: `Cannot ${label} job in ${current.status} status. Must be ${fromStatuses.join(" or ")}.` } };
}

/**
 * releaseJobGpu (P1-2)
 * Returns the job's GPU to the pool, conditional on it still being BUSY.
 */
async function releaseJobGpu(gpuId) {
  if (!gpuId) return;
  const released = await GPU.findOneAndUpdate(
    { _id: gpuId, status: GPU_STATUS.BUSY },
    { $set: { status: GPU_STATUS.ACTIVE, availability: true } }
  );
  if (released) console.log(`${LOG_PREFIX} GPU ${gpuId} released back to ACTIVE.`);
}

// ── Middleware: Worker API Key Auth ────────────────────────────
const crypto = require("crypto");

/**
 * keysMatch (P2-3)
 * Constant-time comparison of the presented and expected API keys, so the
 * response time does not reveal how many leading characters were correct.
 * Both values are hashed first to obtain equal-length buffers.
 */
function keysMatch(presented, expected) {
  const a = crypto.createHash("sha256").update(String(presented)).digest();
  const b = crypto.createHash("sha256").update(String(expected)).digest();
  return crypto.timingSafeEqual(a, b);
}
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

  if (!apiKey || !keysMatch(apiKey, expectedKey)) {
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
    // P1-2: single conditional write — only one caller can start the job.
    const { job, error } = await transition(
      req.params.id, [JOB_STATUS.ASSIGNED], { status: JOB_STATUS.RUNNING }, "start"
    );
    if (error) return res.status(error.code).json({ success: false, message: error.message });

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
 * }
 * A worker-supplied ipfsCid is rejected with 400 (P0-2).
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

    const { resultHash, resultData } = req.body;

    if (!resultHash) {
      return res.status(400).json({
        success: false,
        message: "resultHash is required.",
      });
    }

    // P0-2: a worker-supplied ipfsCid is not accepted. The CID stored on the
    // job must come from the backend's own upload of resultData below, so it
    // can never point outside the IPFS store. (The bundled worker does not
    // send this field.)
    if (req.body.ipfsCid !== undefined) {
      return res.status(400).json({
        success: false,
        message: "ipfsCid is not accepted. Send resultData; the backend stores it and assigns the CID.",
      });
    }

    // ── IPFS Upload ─────────────────────────────────────────
    let finalCid = null;
    if (resultData && ipfsService.isAvailable()) {
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

    // P1-2: the write is conditional on the job still being RUNNING, so a
    // duplicate or late submission cannot overwrite an accepted result.
    const { error: submitError } = await transition(
      job._id, [JOB_STATUS.RUNNING], updates, "submit result for"
    );
    if (submitError) {
      return res.status(submitError.code).json({ success: false, message: submitError.message });
    }

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
    const reason = req.body.reason || "Unknown error";

    // P1-2: claim the transition first; only the winning caller releases the
    // GPU and attempts the refund.
    const { job, error } = await transition(
      req.params.id, [JOB_STATUS.RUNNING, JOB_STATUS.ASSIGNED],
      { status: JOB_STATUS.FAILED, completedAt: new Date() }, "fail"
    );
    if (error) return res.status(error.code).json({ success: false, message: error.message });

    // ── Release the GPU ─────────────────────────────────────
    await releaseJobGpu(job.gpuId);

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
    // P1-2: claim RESULT_UPLOADED → COMPLETED atomically BEFORE any on-chain
    // call, so a duplicate request can never trigger a second verify/release.
    // (As before, the job is completed in MongoDB whether or not the optional
    // on-chain steps succeed; see the integration-boundary notes in README.)
    const { job, error } = await transition(
      req.params.id, [JOB_STATUS.RESULT_UPLOADED],
      { status: JOB_STATUS.COMPLETED, completedAt: new Date() }, "complete"
    );
    if (error) return res.status(error.code).json({ success: false, message: error.message });

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
    await releaseJobGpu(job.gpuId);

    // ── Record the latest on-chain tx hash (status already COMPLETED) ──
    if (lastTxHash !== job.blockchainTxHash) {
      await Job.findByIdAndUpdate(job._id, { $set: { blockchainTxHash: lastTxHash } });
    }

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

    // P0-2: reject malformed identifiers before any storage access
    if (!ipfsService.isValidCid(req.params.cid)) {
      return res.status(400).json({ success: false, message: "Invalid IPFS CID." });
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
