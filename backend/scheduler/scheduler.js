/**
 * scheduler/scheduler.js
 * Scheduler Orchestrator — GPU Compute Exchange (Phase 7)
 *
 * Runs scheduling cycles: finds QUEUED jobs → matches compatible GPUs
 * → atomically assigns the best GPU → updates status to ASSIGNED.
 * → (Phase 7) attempts blockchain assignJob() if service is available.
 *
 * ═══════════════════════════════════════════════════════════════
 * BLOCKCHAIN INTEGRATION (Phase 7)
 * ═══════════════════════════════════════════════════════════════
 * When blockchain service is available (BLOCKCHAIN_RPC_URL etc set):
 *   1. GPU is claimed atomically in MongoDB.
 *   2. Job is updated to ASSIGNED in MongoDB.
 *   3. Blockchain assignJob() is called using the operator wallet.
 *   4. On SUCCESS: blockchainTxHash is stored on the job.
 *   5. On FAILURE: full rollback —
 *        GPU → ACTIVE + available=true
 *        Job → QUEUED + gpuId=null
 *      The cycle continues with the next job.
 *
 * When blockchain service is unavailable (env vars absent):
 *   → Falls back to MongoDB-only mode. No blockchain call is made.
 *   → This is the expected state when Hardhat node is not running.
 *
 * ═══════════════════════════════════════════════════════════════
 * PROVIDER WALLET REQUIREMENT
 * ═══════════════════════════════════════════════════════════════
 * For blockchain assignment, the GPU provider must have a valid
 * Ethereum walletAddress stored in their User record.
 * If walletAddress is missing:
 *   → Blockchain assignment is SKIPPED for that job.
 *   → MongoDB assignment still proceeds (MongoDB-only mode).
 *   → A warning is logged. Job is ASSIGNED in MongoDB but NOT on-chain.
 *
 * ═══════════════════════════════════════════════════════════════
 * CONCURRENCY SAFETY
 * ═══════════════════════════════════════════════════════════════
 * GPU assignment uses a MongoDB atomic findOneAndUpdate with the
 * current state as a condition. If another process already grabbed
 * the GPU between our read and write, the update returns null and
 * we skip that job (it stays QUEUED for the next cycle).
 *
 * The JOB is also claimed conditionally (P0-3): it moves QUEUED → ASSIGNED
 * only if it is still QUEUED with no GPU. If that claim fails (e.g. an
 * overlapping cycle already assigned it), the GPU claimed in this cycle is
 * released again. Cycles never overlap within one process: a cycle that
 * starts while another is running returns immediately (cycleSkipped: true).
 *
 * This module is the ONLY place that writes ASSIGNED status.
 * It does NOT execute jobs — that is Phase 8 (GPU worker).
 */

"use strict";

const Job   = require("../models/Job");
const GPU   = require("../models/GPU");
const User  = require("../models/User");
const { JOB_STATUS }  = require("../models/Job");
const { GPU_STATUS }  = require("../models/GPU");
const { getQueuedJobs, getAvailableGPUs } = require("./queue");
const { findBestGPU } = require("./matcher");
const blockchainService = require("../blockchain/blockchainService");

const LOG_PREFIX = "[Scheduler]";

// P0-3: in-process guard so the polling loop and the dev trigger can never
// run two cycles at the same time.
let cycleInProgress = false;

/**
 * releaseClaimedGpu (P0-3)
 * Returns a GPU claimed by this cycle to the pool. Conditional on the GPU
 * still being BUSY, so it never overrides a different state set elsewhere.
 * Errors are logged with the manual-recovery instruction and re-thrown so
 * the caller can count them; they are never silently ignored.
 * @private
 */
async function releaseClaimedGpu(gpuId, reason) {
  try {
    await GPU.findOneAndUpdate(
      { _id: gpuId, status: GPU_STATUS.BUSY },
      { $set: { status: GPU_STATUS.ACTIVE, availability: true } }
    );
    console.log(`${LOG_PREFIX} GPU ${gpuId} released (${reason}).`);
  } catch (err) {
    console.error(
      `${LOG_PREFIX} 🚨 CRITICAL: could not release GPU ${gpuId} (${reason}): ${err.message}\n` +
      `    Manual intervention required: set status=ACTIVE, availability=true`
    );
    throw err;
  }
}

/**
 * runSchedulerCycle
 * One full scheduling cycle. Safe to call repeatedly.
 *
 * Returns a summary object (useful for the dev endpoint and tests):
 *   { processed, assigned, skipped, noGpuAvailable, blockchainAssigned, blockchainSkipped }
 */
async function runSchedulerCycle() {
  const result = {
    processed:            0,
    assigned:             0,
    skipped:              0,
    noGpuAvailable:       0,
    blockchainAssigned:   0,
    blockchainSkipped:    0,
    blockchainFailed:     0,
    errors:               0,      // P0-3: per-job allocation errors (logged)
  };

  // P0-3: never run two cycles concurrently in this process.
  if (cycleInProgress) {
    console.log(`${LOG_PREFIX} A cycle is already running. Skipping this trigger.`);
    return { ...result, cycleSkipped: true };
  }
  cycleInProgress = true;
  try {
    return await _runCycle(result);
  } finally {
    cycleInProgress = false;
  }
}

/**
 * _runCycle
 * Body of one scheduling cycle (called only through runSchedulerCycle).
 * @private
 */
async function _runCycle(result) {
  console.log(`${LOG_PREFIX} Checking queued jobs…`);

  // ── 1. Fetch QUEUED jobs ──────────────────────────────────────
  const queuedJobs = await getQueuedJobs();

  if (queuedJobs.length === 0) {
    console.log(`${LOG_PREFIX} No queued jobs. Nothing to do.`);
    return result;
  }

  console.log(`${LOG_PREFIX} ${queuedJobs.length} job(s) in queue.`);

  // ── 2. Fetch all currently available GPUs once (read-only) ────
  const availableGPUs = await getAvailableGPUs();
  console.log(`${LOG_PREFIX} ${availableGPUs.length} GPU(s) available in the pool.`);

  const bcAvailable = blockchainService.isAvailable();
  if (bcAvailable) {
    console.log(`${LOG_PREFIX} Blockchain service: AVAILABLE — will attempt on-chain assignment.`);
  } else {
    console.log(`${LOG_PREFIX} Blockchain service: UNAVAILABLE — MongoDB-only mode.`);
  }

  // ── 3. Process each QUEUED job ────────────────────────────────
  for (const job of queuedJobs) {
    result.processed++;
    console.log(`${LOG_PREFIX} Processing job ${job._id} (taskType: ${job.taskType || "unspecified"})`);

    // ── 4. Run the matcher ─────────────────────────────────────
    const bestGpu = findBestGPU(job, availableGPUs);

    if (!bestGpu) {
      result.noGpuAvailable++;
      console.log(`${LOG_PREFIX} Job ${job._id}: No compatible GPU found. Leaving QUEUED.`);
      continue;
    }

    console.log(`${LOG_PREFIX} Job ${job._id}: Best match → GPU ${bestGpu._id} (${bestGpu.gpuModel}, ${bestGpu.gpuMemory}GB, ₹${bestGpu.pricePerHour}/hr)`);

    // ── 5. Atomic GPU claim ────────────────────────────────────
    let claimedGpu = null;
    try {
      claimedGpu = await GPU.findOneAndUpdate(
        {
          _id: bestGpu._id,
          availability: true,
          status: GPU_STATUS.ACTIVE,
        },
        {
          $set: {
            status: GPU_STATUS.BUSY,
            availability: false,
          },
        },
        { returnDocument: "after" }
      );

      if (!claimedGpu) {
        result.skipped++;
        console.log(`${LOG_PREFIX} Job ${job._id}: GPU ${bestGpu._id} was claimed concurrently. Skipping — will retry next cycle.`);
        continue;
      }

      // ── 6. Resolve provider wallet for blockchain ──────────────
      const blockchainJobId = blockchainService.toBlockchainJobId
        ? blockchainService.toBlockchainJobId(job._id)
        : null;

      let providerWalletAddress = null;
      if (bcAvailable && claimedGpu.providerId) {
        try {
          const providerUser = await User.findById(claimedGpu.providerId).select("walletAddress");
          providerWalletAddress = providerUser?.walletAddress ?? null;
        } catch (e) {
          console.warn(`${LOG_PREFIX} Could not fetch provider wallet for GPU ${claimedGpu._id}: ${e.message}`);
        }
      }

      // ── 7. Conditionally claim the job in MongoDB (P0-3) ───────
      // Only a job that is still QUEUED with no GPU can be assigned. If an
      // overlapping cycle (or any other writer) got there first, release the
      // GPU claimed above so it is not left BUSY without a job.
      const assignedJob = await Job.findOneAndUpdate(
        { _id: job._id, status: JOB_STATUS.QUEUED, gpuId: null },
        {
          $set: {
            status:          JOB_STATUS.ASSIGNED,
            gpuId:           claimedGpu._id,
            blockchainJobId: blockchainJobId,
          },
        },
        { returnDocument: "after" }
      );

      if (!assignedJob) {
        result.skipped++;
        console.log(`${LOG_PREFIX} Job ${job._id}: no longer QUEUED (claimed elsewhere). Releasing GPU ${claimedGpu._id}.`);
        await releaseClaimedGpu(claimedGpu._id, `job ${job._id} was not claimable`);
        continue;
      }

      result.assigned++;
      console.log(`${LOG_PREFIX} ✅ Job ${job._id} assigned to GPU ${claimedGpu._id} (${claimedGpu.gpuModel}).`);

      // Remove the claimed GPU from the in-memory pool so it won't be reused
      // in this cycle (also when the blockchain step below rolls it back; the
      // next cycle re-reads the pool).
      const idx = availableGPUs.findIndex((g) => String(g._id) === String(claimedGpu._id));
      if (idx !== -1) availableGPUs.splice(idx, 1);

      // ── 8. Blockchain assignment ───────────────────────────────
      if (bcAvailable) {
        await _attemptBlockchainAssignment(job, claimedGpu, blockchainJobId, providerWalletAddress, result);
      }
    } catch (err) {
      // P0-3: an unexpected error during allocation must not leave a GPU
      // BUSY. If the job was not assigned to this GPU, release the GPU.
      result.errors++;
      console.error(`${LOG_PREFIX} ❌ Allocation error for job ${job._id}: ${err.message}`);
      if (claimedGpu) {
        try {
          const current = await Job.findById(job._id).select("status gpuId");
          const heldByThisJob = current && current.status === JOB_STATUS.ASSIGNED &&
            String(current.gpuId) === String(claimedGpu._id);
          if (!heldByThisJob) {
            await releaseClaimedGpu(claimedGpu._id, `allocation error for job ${job._id}`);
          }
        } catch (recoveryErr) {
          console.error(`${LOG_PREFIX} 🚨 Recovery after allocation error failed for job ${job._id}: ${recoveryErr.message}`);
        }
      }
    }
  }

  console.log(
    `${LOG_PREFIX} Cycle complete — processed: ${result.processed}, ` +
    `assigned: ${result.assigned}, skipped: ${result.skipped}, ` +
    `no-gpu: ${result.noGpuAvailable}, ` +
    `bc-assigned: ${result.blockchainAssigned}, bc-skipped: ${result.blockchainSkipped}, ` +
    `bc-failed: ${result.blockchainFailed}`
  );

  return result;
}

/**
 * _attemptBlockchainAssignment
 * Tries to call assignJob() on the contract. On failure, rolls back
 * GPU and Job to their pre-assignment state so the next cycle can retry.
 *
 * Failure recovery:
 *   - GPU: BUSY + availability=false → ACTIVE + availability=true
 *   - Job: ASSIGNED + gpuId set      → QUEUED  + gpuId=null
 *
 * @private
 */
async function _attemptBlockchainAssignment(job, claimedGpu, blockchainJobId, providerWalletAddress, result) {
  // ── No provider wallet — skip blockchain but keep MongoDB assignment ──
  if (!providerWalletAddress) {
    result.blockchainSkipped++;
    console.warn(
      `${LOG_PREFIX} ⚠️  Job ${job._id}: Provider has no walletAddress. ` +
      `Blockchain assignment SKIPPED. MongoDB assignment is still valid. ` +
      `Ask the provider to add a wallet address to enable on-chain escrow.`
    );
    return;
  }

  // ── Attempt blockchain assignJob() ──────────────────────────
  try {
    const receipt = await blockchainService.assignJob(blockchainJobId, providerWalletAddress);

    // Success — store tx hash
    await Job.findByIdAndUpdate(job._id, {
      $set: { blockchainTxHash: receipt.txHash },
    });

    result.blockchainAssigned++;
    console.log(
      `${LOG_PREFIX} ⛓️  Blockchain assignJob confirmed. ` +
      `job=${job._id} tx=${receipt.txHash}`
    );
  } catch (err) {
    // ── FAILURE — ROLLBACK ────────────────────────────────────
    result.blockchainFailed++;
    console.error(
      `${LOG_PREFIX} ❌ Blockchain assignJob FAILED for job ${job._id}: ${err.message}`
    );
    console.error(`${LOG_PREFIX}    Initiating rollback: GPU → ACTIVE, Job → QUEUED`);

    try {
      // P0-3: roll the job back ONLY if it is still ASSIGNED to this GPU.
      // A worker may already have started it (ASSIGNED → RUNNING) while the
      // on-chain call was pending; in that case the job keeps its GPU.
      const rolledBack = await Job.findOneAndUpdate(
        { _id: job._id, status: JOB_STATUS.ASSIGNED, gpuId: claimedGpu._id },
        {
          $set: {
            status:          JOB_STATUS.QUEUED,
            gpuId:           null,
            blockchainJobId: null,
          },
        },
        { returnDocument: "after" }
      );

      if (!rolledBack) {
        console.warn(
          `${LOG_PREFIX} ⚠️  Job ${job._id} is no longer ASSIGNED to GPU ${claimedGpu._id}; ` +
          `MongoDB rollback skipped and the GPU stays with the job.`
        );
        return;
      }

      // Release the GPU (conditional on it still being BUSY)
      await GPU.findOneAndUpdate(
        { _id: claimedGpu._id, status: GPU_STATUS.BUSY },
        { $set: { status: GPU_STATUS.ACTIVE, availability: true } }
      );

      console.log(`${LOG_PREFIX} ✅ Rollback complete. Job ${job._id} returned to QUEUED.`);
    } catch (rollbackErr) {
      // If rollback itself fails, log it prominently but don't crash
      console.error(
        `${LOG_PREFIX} 🚨 CRITICAL: Rollback FAILED for job ${job._id}: ${rollbackErr.message}\n` +
        `    Manual intervention required:\n` +
        `      GPU ${claimedGpu._id}: set status=ACTIVE, availability=true\n` +
        `      Job ${job._id}: set status=QUEUED, gpuId=null`
      );
    }
  }
}

/**
 * startSchedulerPolling
 * Starts a non-blocking polling loop.
 * The interval is read from SCHEDULER_INTERVAL_MS (default: 10s).
 *
 * Call this once from index.js after the DB connects.
 * Returns the interval ID so the caller can stop it if needed.
 *
 * @returns {NodeJS.Timeout}
 */
function startSchedulerPolling() {
  const intervalMs = parseInt(process.env.SCHEDULER_INTERVAL_MS || "10000", 10);
  console.log(`${LOG_PREFIX} Polling started — interval: ${intervalMs}ms`);

  const id = setInterval(async () => {
    try {
      await runSchedulerCycle();
    } catch (err) {
      // Never crash the server on a scheduler error
      console.error(`${LOG_PREFIX} ERROR during cycle:`, err.message);
    }
  }, intervalMs);

  // Don't keep the Node process alive just for the scheduler
  if (id.unref) id.unref();

  return id;
}

module.exports = { runSchedulerCycle, startSchedulerPolling };
