"use strict";
const crypto = require("crypto");
const fs = require("fs/promises");
const path = require("path");
const { execFile } = require("child_process");
const { promisify } = require("util");
const Job = require("../models/Job");
const GPU = require("../models/GPU");
const bc = require("../blockchain/blockchainService");
const chain = require("./realChain");
const { findBestGPU, parseCuda } = require("../scheduler/matcher");
const runFile = promisify(execFile);
const artifactRoot = path.resolve(process.env.RESULT_STORAGE_DIR || path.join(__dirname, "../results"));
const { hash, pinVerified, readVerified } = require("./artifactStorage");
const clockId = crypto.randomUUID();
const fail = (message, statusCode = 400) => Object.assign(new Error(message), { statusCode });
const mode = () => process.env.EXECUTION_MODE || "real_gpu";
const fresh = () => new Date(Date.now() - 30000);

function specification(body) {
  const input = body.input || {};
  const spec = { size: input.size ?? 128, seed: input.seed ?? 42, dtype: "float32", executionMode: mode() };
  if (body.taskType !== "matrix_multiply" || !Number.isInteger(spec.size) || spec.size < 2 || spec.size > 1024 ||
      !Number.isInteger(spec.seed) || spec.seed < 0 || spec.seed > 2147483647) throw fail("Choose matrix_multiply, size 2–1024, and a nonnegative integer seed");
  if (Object.keys(input).some((key) => !["size", "seed"].includes(key))) throw fail("Unknown workload input");
  const requirements = body.requirements || {};
  for (const [key, value] of Object.entries(requirements)) {
    if (!["requiredGpuMemory", "requiredCudaVersion", "maximumPrice"].includes(key)) throw fail("Unknown GPU requirement");
    if (key === "requiredCudaVersion" ? !parseCuda(value) : typeof value !== "number" || !Number.isFinite(value) || value < 0) throw fail("Invalid GPU requirement");
  }
  return { spec, requirements };
}
async function locked(id, fn) {
  const token = crypto.randomUUID();
  const job = await Job.findOneAndUpdate({ _id: id, protocol: "real", $or: [
    { lockUntil: { $exists: false } }, { lockUntil: null }, { lockUntil: { $lt: new Date() } },
  ] }, { $set: { lockToken: token, lockUntil: new Date(Date.now() + 180000) } }, { returnDocument: "after" }).select("+artifactPath");
  if (!job) throw fail("Job operation in progress or job not found", 409);
  try { return await fn(job); }
  finally { await Job.updateOne({ _id: id, lockToken: token }, { $unset: { lockToken: 1, lockUntil: 1 } }); }
}
async function release(job) {
  if (job.gpuId) await GPU.updateOne({ _id: job.gpuId, activeJob: job._id }, {
    $set: { activeJob: null, status: "ACTIVE" },
  });
}
async function create(user, body) {
  const { spec, requirements } = specification(body);
  const reservedMinutes = body.reservedMinutes ?? 1;
  if (!Number.isInteger(reservedMinutes) || reservedMinutes < 1 || reservedMinutes > 10) throw fail("Reserve 1–10 minutes");
  const rate = process.env.RATE_WEI_PER_MINUTE || "1000000000000000";
  if (!/^[1-9][0-9]*$/.test(rate)) throw fail("Invalid configured rate", 503);
  const specHash = hash(JSON.stringify({ spec, requirements }));
  const job = new Job({ consumerId: user._id, protocol: "real", status: "AWAITING_FUNDING", taskType: "matrix_multiply",
    spec, specHash, input: { ...spec, requirements }, price: 0, reservedMinutes,
    rateWeiPerMinute: rate, escrowAmountWei: (BigInt(rate) * BigInt(reservedMinutes)).toString() });
  job.blockchainJobId = bc.toBlockchainJobId(job._id);
  await job.save();
  return job;
}
async function fund(id) {
  return locked(id, async (job) => {
    if (job.status !== "AWAITING_FUNDING") throw fail("Job is no longer awaiting funding", 409);
    if (process.env.BLOCKCHAIN_DEMO_MODE !== "true" || !bc.demoConsumerWallet) throw fail("Demo wallet is unavailable", 503);
    if (bc.demoConsumerWallet.address === bc.operatorWallet.address) throw fail("Consumer and operator must differ");
    job.chainInstance = await chain.check(job);
    await job.save();
    let onChain = await bc.getJob(job.blockchainJobId);
    if (onChain.status === 0) await chain.send(job, "registerJob", [job.blockchainJobId], true);
    onChain = await bc.getJob(job.blockchainJobId);
    if (onChain.consumer.toLowerCase() !== bc.demoConsumerWallet.address.toLowerCase()) throw fail("Consumer wallet mismatch");
    if (onChain.status === 1) await chain.send(job, "depositFunds", [job.blockchainJobId], true, BigInt(job.escrowAmountWei));
    onChain = await bc.getJob(job.blockchainJobId);
    const events = await chain.events(job);
    if (onChain.status !== 2 || onChain.payment !== job.escrowAmountWei || events.FundsDeposited?.amount.toString() !== job.escrowAmountWei) throw fail("Funding not confirmed", 409);
    await Job.updateOne({ _id: id }, { $set: { status: "QUEUED", fundedAt: new Date(),
      queueClockId: clockId, queueStartMs: performance.now(), error: null } });
    return Job.findById(id);
  });
}
async function reconcile(job) {
  await chain.check(job);
  const state = await bc.getJob(job.blockchainJobId);
  if (state.status === 0 && job.status !== "AWAITING_FUNDING") throw fail("Escrow missing; possible chain reset", 409);
  if (state.status === 6 || state.status === 7) {
    const events = await chain.events(job);
    if (state.status === 6) {
      if (!events.PaymentReleased || !state.paymentReleased || !job.verification?.verified ||
          state.resultHash.toLowerCase() !== `0x${job.resultHash}` ||
          state.provider.toLowerCase() !== job.providerWallet?.toLowerCase() ||
          events.PaymentReleased.provider.toLowerCase() !== job.providerWallet?.toLowerCase() ||
          events.PaymentReleased.amount.toString() !== job.escrowAmountWei) throw fail("Payment/result reconciliation mismatch", 409);
      await Job.updateOne({ _id: job._id }, { $set: { status: "COMPLETED", completedAt: job.completedAt || new Date(),
        paymentWei: events.PaymentReleased.amount.toString(), error: null } });
    } else {
      if (!events.RefundIssued) throw fail("Refund event missing", 409);
      await Job.updateOne({ _id: job._id }, { $set: { status: "REFUNDED", completedAt: job.completedAt || new Date() } });
    }
    await release(job);
  }
  return state;
}
async function settle(id) {
  return locked(id, async (job) => {
    let state = await reconcile(job);
    if ([6, 7].includes(state.status)) return Job.findById(id);
    if (!job.verification?.verified || !job.resultHash || !job.artifactPath) throw fail("Verified artifact required", 409);
    await readVerified(job);
    if (![4, 5].includes(state.status) || state.resultHash.toLowerCase() !== `0x${job.resultHash}` ||
        state.provider.toLowerCase() !== job.providerWallet.toLowerCase()) throw fail("Awaiting matching provider-signed result", 409);
    await Job.updateOne({ _id: id }, { $set: { status: "SETTLEMENT_PENDING" } });
    await chain.events(job);
    if (state.status === 4) await chain.send(job, "verifyResult", [job.blockchainJobId, `0x${job.resultHash}`]);
    state = await bc.getJob(job.blockchainJobId);
    if (state.status === 5) await chain.send(job, "releasePayment", [job.blockchainJobId]);
    await reconcile(job);
    return Job.findById(id);
  });
}
async function refund(id, reason) {
  return locked(id, async (job) => {
    if (["COMPLETED", "REFUNDED", "CANCELLED"].includes(job.status)) return job;
    if (!job.chainInstance) {
      await Job.updateOne({ _id: id }, { $set: { status: "CANCELLED", error: reason, completedAt: new Date() } });
      return Job.findById(id);
    }
    const state = await reconcile(job);
    if ([6, 7].includes(state.status)) return Job.findById(id);
    if (state.status === 5) throw fail("Verified escrow must settle, not refund", 409);
    await Job.updateOne({ _id: id }, { $set: { status: "REFUND_PENDING", leaseExpiresAt: new Date(0), error: reason } });
    if ([2, 3, 4].includes(state.status)) {
      await chain.send(job, "refund", [job.blockchainJobId]);
      await reconcile(job);
    } else {
      await Job.updateOne({ _id: id }, { $set: { status: "CANCELLED", completedAt: new Date() } });
      await release(job);
    }
    return Job.findById(id);
  });
}
async function assign(id) {
  return locked(id, async (job) => {
    if (job.status !== "QUEUED") return;
    const schedulingStart = performance.now();
    await chain.check(job);
    if (job.specHash !== hash(JSON.stringify({ spec: job.spec, requirements: job.input.requirements || {} }))) throw fail("Workload specification changed");
    const state = await bc.getJob(job.blockchainJobId);
    if (state.payment !== job.escrowAmountWei || ![2, 3].includes(state.status)) throw fail("Confirmed funded escrow required");
    let gpu = job.gpuId ? await GPU.findOne({ _id: job.gpuId, activeJob: job._id }) : null;
    // An on-chain assignment is permanent for this job. Never choose a different
    // slot if the reservation was lost during an interrupted assignment.
    if (!gpu && (job.gpuId || state.status === 3)) throw fail("Assignment reservation lost; cancel/refund this job", 409);
    if (!gpu) {
      const pool = await GPU.find({ availability: true, status: "ACTIVE", activeJob: null,
        executionMode: job.spec.executionMode, lastHeartbeat: { $gte: fresh() } }).lean();
      const best = findBestGPU(job, pool);
      if (!best) return;
      // A job may have been reserved before a process crash. Its conditional GPU
      // claim is recovered by the periodic orphan sweep below.
      gpu = await GPU.findOneAndUpdate({ _id: best._id, status: "ACTIVE", activeJob: null,
        availability: true, lastHeartbeat: { $gte: fresh() } },
      { $set: { status: "BUSY", activeJob: job._id } }, { returnDocument: "after" });
      if (!gpu) return;
      await Job.updateOne({ _id: id }, { $set: { gpuId: gpu._id, providerWallet: gpu.providerWallet,
        leaseId: crypto.randomUUID(), leaseExpiresAt: new Date(Date.now() + 60000) } });
      job.gpuId = gpu._id; job.providerWallet = gpu.providerWallet;
    }
    if (state.status === 2) await chain.send(job, "assignJob", [job.blockchainJobId, job.providerWallet]);
    const assigned = await bc.getJob(job.blockchainJobId);
    if (assigned.status !== 3 || assigned.provider.toLowerCase() !== job.providerWallet.toLowerCase()) throw fail("Assignment mismatch");
    await chain.events(job);
    await Job.updateOne({ _id: id }, { $set: { status: "ASSIGNED", assignedAt: new Date(),
      schedulingMs: performance.now() - schedulingStart,
      queueWaitMs: job.queueClockId === clockId ? schedulingStart - job.queueStartMs : null, error: null } });
  });
}
async function acceptArtifact(id, gpu, leaseId, bytes, resultHash, metadata, receiveMs) {
  return locked(id, async (job) => {
    if (String(job.gpuId) !== String(gpu._id) || job.leaseId !== leaseId || job.leaseExpiresAt < new Date()) throw fail("Stale or unauthorized lease", 409);
    if (!Buffer.isBuffer(bytes) || hash(bytes) !== resultHash) throw fail("Artifact SHA-256 mismatch");
    if (["RESULT_UPLOADED", "SETTLEMENT_PENDING", "COMPLETED"].includes(job.status) && resultHash === job.resultHash) return job;
    if (job.status !== "RUNNING") throw fail("Job must be running", 409);
    if (!metadata?.spec || Object.keys(metadata.spec).length !== Object.keys(job.spec).length ||
        Object.entries(job.spec).some(([key, value]) => metadata.spec[key] !== value)) throw fail("Result specification mismatch");
    if (metadata.sha256 !== resultHash || metadata.artifactBytes !== bytes.length ||
        metadata.capabilities?.executionMode !== job.spec.executionMode) throw fail("Result metadata does not match uploaded artifact");
    await fs.mkdir(artifactRoot, { recursive: true });
    const file = path.join(artifactRoot, `${job._id}-${crypto.randomUUID()}.npy`);
    let keepFile = false;
    try {
      await fs.writeFile(file, bytes, { flag: "wx" });
      const { stdout } = await runFile(process.env.PYTHON_EXECUTABLE || "python", [path.resolve(__dirname, "../../worker/matrix_workload.py"),
        "verify", "--spec", JSON.stringify(job.spec), "--artifact", file], { timeout: 60000, maxBuffer: 1024 * 1024 });
      const verification = JSON.parse(stdout);
      if (!verification.verified) throw fail("Numerical verification failed");
      const ipfsCid = await pinVerified(bytes);
      // An interrupted database write can have committed. Preserve its exact file
      // until recovery determines whether the job references this path.
      keepFile = true;
      const accepted = await Job.updateOne({ _id: id, status: "RUNNING", leaseId,
        leaseExpiresAt: { $gt: new Date() } }, { $set: {
        status: "RESULT_UPLOADED", artifactPath: file, ipfsCid, resultHash, resultMetadata: metadata, verification, receiveMs,
      } });
      if (!accepted.matchedCount) {
        keepFile = false;
        throw fail("Lease expired before artifact acceptance", 409);
      }
    } catch (error) {
      if (!keepFile && error.code !== "EEXIST") await fs.unlink(file).catch(() => {});
      if (error.code === 1) throw fail("Artifact failed independent numerical verification");
      throw error;
    }
    return Job.findById(id);
  });
}
let cycling = false;
async function invalidatePreviousChain() {
  const current = await chain.instance();
  const stale = await Job.find({ protocol: "real", chainInstance: { $exists: true, $nin: [null, current] },
    status: { $ne: "FAILED" } });
  for (const job of stale) {
    await Job.updateOne({ _id: job._id, chainInstance: job.chainInstance }, { $set: {
      status: "FAILED", error: "CHAIN_RESET: historical receipts belong to a previous local chain; create a new job",
    }, $unset: { paymentWei: 1 } });
    await release(job);
  }
  return stale.length;
}
async function cycle() {
  if (cycling) return;
  cycling = true;
  try {
    await invalidatePreviousChain();
    const jobs = await Job.find({ protocol: "real", status: { $nin: ["CANCELLED", "FAILED", "REFUNDED", "COMPLETED"] } });
    for (const job of jobs) {
      try {
        if (job.status === "QUEUED") {
          if (job.gpuId && job.leaseExpiresAt < new Date()) await refund(job._id, "Assignment lease expired during recovery");
          else await assign(job._id);
        }
        else if (job.status === "REFUND_PENDING") await refund(job._id, job.error);
        else if (["RESULT_UPLOADED", "SETTLEMENT_PENDING"].includes(job.status)) {
          const state = await bc.getJob(job.blockchainJobId);
          if (state.status === 3 && job.leaseExpiresAt < new Date()) await refund(job._id, "Provider submission deadline expired");
          else if (state.status !== 3) await settle(job._id);
        }
        else if (["ASSIGNED", "RUNNING"].includes(job.status) && job.leaseExpiresAt < new Date()) await refund(job._id, "Worker lease expired");
      } catch (error) {
        if (error.statusCode === 409 && error.message.includes("operation in progress")) continue;
        await Job.updateOne({ _id: job._id }, { $set: { error: error.message } });
        if (error.message.startsWith("CHAIN_RESET")) {
          await Job.updateOne({ _id: job._id }, { $set: { status: "FAILED" } });
          await release(job);
        }
      }
    }
    for (const gpu of await GPU.find({ activeJob: { $ne: null } })) {
      const job = await Job.findById(gpu.activeJob).select("+lockUntil");
      if (!job || (["COMPLETED", "REFUNDED", "FAILED", "CANCELLED"].includes(job.status)) ||
          (!job.gpuId && (!job.lockUntil || job.lockUntil < new Date()))) {
        await GPU.updateOne({ _id: gpu._id, activeJob: gpu.activeJob }, { $set: { activeJob: null, status: "ACTIVE" } });
      }
    }
  } finally { cycling = false; }
}
module.exports = { mode, hash, fail, fresh, specification, locked, create, fund, settle, refund, cycle, acceptArtifact, artifactRoot, invalidatePreviousChain };
