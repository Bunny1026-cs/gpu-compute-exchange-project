"use strict";
const express = require("express");
const crypto = require("crypto");
const storage = require("../services/artifactStorage");
const { ethers } = require("ethers");
const Job = require("../models/Job");
const GPU = require("../models/GPU");
const { protect } = require("../middleware/authMiddleware");
const { requireRole } = require("../middleware/roleMiddleware");
const compute = require("../services/realCompute");
const bc = require("../blockchain/blockchainService");
const chain = require("../services/realChain");
const router = express.Router();
const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const ok = (res, data) => res.json({ success: true, data });
const provider = [protect, requireRole("PROVIDER")];
const consumer = [protect, requireRole("CONSUMER")];
const owner = async (req, allowProvider = false) => {
  const job = await Job.findById(req.params.id).select("+artifactPath");
  if (!job || job.protocol !== "real") throw compute.fail("Job not found", 404);
  const gpu = job.gpuId && allowProvider ? await GPU.findById(job.gpuId) : null;
  if (String(job.consumerId) !== String(req.user._id) && String(gpu?.providerId) !== String(req.user._id)) throw compute.fail("Access denied", 403);
  return job;
};
require("./batchRoutes")(router, { provider, consumer, protect, owner, wrap, ok });
router.get("/compute/config", protect, wrap(async (_req, res) => ok(res, {
  executionMode: compute.mode(), cpuBatchEnabled: process.env.FINAL_DEMO === "false", rateWeiPerMinute: process.env.RATE_WEI_PER_MINUTE || "1000000000000000",
  storage: storage.kuboConfigured() ? "kubo_with_local_fallback" : "local_file", chainReady: bc.isAvailable(), workload: "matrix_multiply", maxMatrixSize: 1024,
})));
router.post("/jobs", ...consumer, wrap(async (req, res) => { res.status(201); ok(res, await compute.create(req.user, req.body)); }));
router.post("/jobs/:id/fund", ...consumer, wrap(async (req, res) => { await owner(req); ok(res, await compute.fund(req.params.id)); }));
router.post("/jobs/:id/cancel", ...consumer, wrap(async (req, res) => { await owner(req); ok(res, await compute.refund(req.params.id, "Cancelled by consumer", { consumer: true })); }));
router.post("/jobs/:id/reconcile", protect, wrap(async (req, res) => { const job = await owner(req, true);
  ok(res, job.status === "REFUND_PENDING" ? await compute.refund(job._id, job.error) : await compute.settle(job._id));
}));
router.get("/jobs/:id/artifact", protect, wrap(async (req, res) => {
  const job = await owner(req, true);
  if (!job.artifactPath || job.taskType === "python_batch") throw compute.fail("Use the named output download for script jobs", 404);
  const data = await storage.readVerified(job);
  res.set("Content-Type", "application/octet-stream").set("Content-Disposition", `attachment; filename="${job._id}.npy"`).send(data);
}));
router.get("/jobs/:id/result", protect, wrap(async (req, res) => {
  const job = await owner(req, true);
  ok(res, { jobId: job._id, status: job.status, resultHash: job.resultHash, storage: job.resultHash ? (job.ipfsCid ? "ipfs_and_local_file" : "local_file") : null, ipfsCid: job.ipfsCid,
    result: { metadata: job.resultMetadata, verification: job.verification, receipts: job.receipts } });
}));
// Credentials are scoped to one provider-owned slot. Rotation invalidates old credentials.
router.post("/gpus/:id/worker-key", ...provider, wrap(async (req, res) => {
  const key = crypto.randomBytes(32).toString("hex");
  const wallet = req.body.walletAddress;
  if (!ethers.isAddress(wallet) || wallet === ethers.ZeroAddress) throw compute.fail("Valid provider development wallet required");
  if ([bc.operatorWallet?.address, bc.demoConsumerWallet?.address].some((address) => address?.toLowerCase() === wallet.toLowerCase())) throw compute.fail("Provider, consumer, and operator wallets must differ");
  const gpu = await GPU.findOneAndUpdate({ _id: req.params.id, providerId: req.user._id, agentId: { $exists: false }, retiredAt: null, activeJob: null, status: { $ne: "BUSY" } },
    { $set: { workerKeyHash: compute.hash(key), providerWallet: ethers.getAddress(wallet), lastHeartbeat: null, capabilities: null } }, { returnDocument: "after" });
  if (!gpu) throw compute.fail("Slot not found or currently busy", 409);
  ok(res, { gpuId: gpu._id, workerApiKey: key, providerWallet: gpu.providerWallet });
}));
router.get("/gpus", protect, wrap(async (req, res) => {
  const mine = req.query.mine === "true";
  const profiles = require("../services/batch").profiles;
  const supportedImages = process.env.FINAL_DEMO !== "false" ? [profiles["pytorch-cuda"]] : Object.values(profiles);
  const filter = mine ? { providerId: req.user._id } : { availability: true, status: "ACTIVE", lastHeartbeat: { $gte: compute.fresh() },
    $or: [{ agentId: { $exists: false }, executionMode: compute.mode() }, { agentId: { $exists: true }, "capabilities.testedImage": { $in: supportedImages } }] };
  const gpus = await GPU.find({ ...filter, retiredAt: null }).lean();
  ok(res, gpus.map((gpu) => ({ ...gpu, online: gpu.lastHeartbeat >= compute.fresh() })));
}));
// Manual registration creates an offline slot; only authenticated worker reports supply capabilities.
router.post("/gpus", ...provider, wrap(async (req, res) => {
  const gpu = await GPU.create({ providerId: req.user._id, gpuModel: "Awaiting worker detection", gpuMemory: 0,
    cudaVersion: "0", pricePerHour: 0, availability: true, status: "ACTIVE" });
  res.status(201); ok(res, gpu);
}));
router.put("/gpus/:id", ...provider, wrap(async (req, res) => {
  const updates = {};
  if (typeof req.body.availability === "boolean") updates.availability = req.body.availability;
  if (["ACTIVE", "INACTIVE"].includes(req.body.status)) updates.status = req.body.status;
  if (!Object.keys(updates).length) throw compute.fail("Only listing and active/inactive controls are editable; capabilities come from worker");
  const gpu = await GPU.findOneAndUpdate({ _id: req.params.id, providerId: req.user._id, retiredAt: null, activeJob: null, status: { $ne: "BUSY" } },
    { $set: updates }, { returnDocument: "after" });
  if (!gpu) throw compute.fail("Slot is busy or inaccessible", 409);
  ok(res, gpu);
}));

// Keep ownership of historical jobs after a provider removes a slot.
router.delete("/gpus/:id", ...provider, wrap(async (req, res) => {
  const gpu = await GPU.findOneAndUpdate({ _id: req.params.id, providerId: req.user._id,
    activeJob: null, status: { $ne: "BUSY" }, retiredAt: null }, {
    $set: { retiredAt: new Date(), availability: false, status: "INACTIVE", lastHeartbeat: null },
    $unset: { workerKeyHash: 1, workerSession: 1 },
  });
  if (!gpu) throw compute.fail("Slot is busy or inaccessible", 409);
  ok(res, { gpuId: gpu._id });
}));

const worker = express.Router();
worker.use(wrap(async (req, _res, next) => {
  const key = req.get("X-Worker-API-Key");
  if (!key || !/^[0-9a-f]{64}$/.test(key)) throw compute.fail("Invalid worker credential", 401);
  const gpu = await GPU.findOne({ workerKeyHash: compute.hash(key) }).select("+workerSession");
  if (!gpu) throw compute.fail("Invalid worker credential", 401);
  if (gpu.agentId && gpu.executionMode === "real_cpu_test" && process.env.FINAL_DEMO !== "false") throw compute.fail("CPU pilot disabled", 403);
  const session = req.get("X-Worker-Session");
  if (!session || !/^[0-9a-f-]{36}$/.test(session)) throw compute.fail("Worker session required", 401);
  if (req.path !== "/heartbeat" && gpu.workerSession !== session) throw compute.fail("Worker session was superseded", 409);
  req.gpu = gpu;
  next();
}));
worker.post("/heartbeat", wrap(async (req, res) => {
  const cap = req.body.capabilities;
  const expectedMode = req.gpu.agentId ? req.gpu.executionMode : compute.mode();
  if (!cap || cap.executionMode !== expectedMode || typeof cap.gpuModel !== "string" || cap.gpuModel.length > 200 ||
      !Number.isFinite(cap.gpuMemory) || cap.gpuMemory < 0 || !parseCudaSafe(cap.cudaVersion) ||
      (cap.executionMode === "real_gpu" && (!req.gpu.agentId || cap.testedImage) && (!cap.computeCapability || cap.gpuMemory <= 0))) throw compute.fail("Worker capabilities do not match required execution mode");
  if (req.body.walletAddress?.toLowerCase() !== req.gpu.providerWallet?.toLowerCase()) throw compute.fail("Worker wallet does not match registered provider wallet", 403);
  const session = req.get("X-Worker-Session");
  const updated = await GPU.updateOne({ _id: req.gpu._id, retiredAt: null,
    workerKeyHash: compute.hash(req.get("X-Worker-API-Key")), $or: [{ workerSession: session },
    { workerSession: { $exists: false } }, { lastHeartbeat: null }, { lastHeartbeat: { $lt: compute.fresh() } }] },
  { $set: { workerSession: session, capabilities: cap, executionMode: cap.executionMode,
    gpuModel: cap.gpuModel, gpuMemory: cap.gpuMemory, cudaVersion: cap.cudaVersion, lastHeartbeat: new Date() } });
  if (!updated.matchedCount) throw compute.fail("Another worker session owns this slot", 409);
  if (req.body.jobId && req.body.leaseId) {
    const job = await Job.findOne({ _id: req.body.jobId, gpuId: req.gpu._id, leaseId: req.body.leaseId,
      leaseExpiresAt: { $gt: new Date() }, status: { $in: ["ASSIGNED", "RUNNING", "RESULT_UPLOADED", "SETTLEMENT_PENDING"] } });
    if (job) {
      const deadline = new Date(job.assignedAt).getTime() + job.reservedMinutes * 60000 + 120000;
      await Job.updateOne({ _id: job._id, leaseId: job.leaseId, status: job.status }, { $set: { leaseExpiresAt: new Date(Math.min(Date.now() + 45000, deadline)) } });
    }
  }
  ok(res, { gpuId: req.gpu._id });
}));
function parseCudaSafe(value) { return require("../scheduler/matcher").parseCuda(value); }
worker.get("/jobs", wrap(async (req, res) => {
  const jobs = await Job.find({ protocol: "real", gpuId: req.gpu._id, leaseExpiresAt: { $gt: new Date() },
    status: { $in: req.gpu.agentId ? ["QUEUED","ASSIGNED","RUNNING","RESULT_UPLOADED"] : ["ASSIGNED", "RUNNING", "RESULT_UPLOADED", "SETTLEMENT_PENDING"] } }).lean();
  ok(res, jobs.map((job) => ({ ...job, contractAddress: bc.contractAddress })));
}));
worker.use("/jobs/:id", wrap(async (req, _res, next) => {
  const job = await Job.findOne({ _id: req.params.id, protocol: "real", gpuId: req.gpu._id,
    leaseId: req.get("X-Job-Lease"), leaseExpiresAt: { $gt: new Date() } });
  if (!job) throw compute.fail("Stale or unauthorized job lease", 409);
  await chain.check(job);
  req.job = job;
  next();
}));
worker.get("/jobs/:id/source", wrap(async(req,res)=>{
  if (req.job.taskType !== "python_batch" || !["ASSIGNED","RUNNING"].includes(req.job.status)) throw compute.fail("Script unavailable",409);
  const job = await Job.findOne({_id:req.job._id,leaseId:req.job.leaseId,leaseExpiresAt:{$gt:new Date()},status:req.job.status}).select("+scriptSource");
  if (!job) throw compute.fail("Stale lease",409);
  ok(res,{source:job.scriptSource});
}));
worker.post("/jobs/:id/ready",wrap(async(req,res)=>{
  if (req.job.taskType !== "python_batch") throw compute.fail("Script reservation required");
  const update = req.body.ready === true ? {readyLease:req.job.leaseId} : {leaseExpiresAt:new Date(0)};
  const result=await Job.updateOne({_id:req.job._id,status:"QUEUED",gpuId:req.gpu._id,leaseId:req.job.leaseId,leaseExpiresAt:{$gt:new Date()}},{$set:update});
  if (!result.matchedCount) throw compute.fail("Reservation expired",409);
  ok(res,{ready:req.body.ready === true});
}));
worker.post("/jobs/:id/log",wrap(async(req,res)=>{
  const result=await Job.updateOne({_id:req.job._id,status:"RUNNING",gpuId:req.gpu._id,leaseId:req.job.leaseId,leaseExpiresAt:{$gt:new Date()}},{$set:{liveLog:String(req.body.tail || "").slice(-8192)}});
  if (!result.matchedCount) throw compute.fail("Stale lease",409);
  ok(res,{updated:true});
}));
worker.post("/jobs/:id/start", wrap(async (req, res) => {
  const state = await bc.getJob(req.job.blockchainJobId);
  if (state.status !== 3 || state.provider.toLowerCase() !== req.gpu.providerWallet.toLowerCase()) throw compute.fail("On-chain assignment required", 409);
  const job = await Job.findOneAndUpdate({ _id: req.job._id, status: "ASSIGNED", leaseId: req.job.leaseId },
    { $set: { status: "RUNNING", startedAt: new Date() } }, { returnDocument: "after" });
  if (!job && req.job.status !== "RUNNING") throw compute.fail("Job cannot be started", 409);
  ok(res, job || req.job);
}));
worker.post("/jobs/:id/result", (req, _res, next) => {
  req.receiveStart = performance.now();
  next();
}, express.raw({ type: "application/octet-stream", limit: "5mb" }), wrap(async (req, res) => {
  const receiveMs = performance.now() - req.receiveStart;
  let metadata;
  try { metadata = JSON.parse(Buffer.from(req.get("X-Result-Metadata") || "", "base64").toString()); }
  catch { throw compute.fail("Invalid result metadata"); }
  ok(res, await compute.acceptArtifact(req.job._id, req.gpu, req.job.leaseId, req.body, req.get("X-Result-Hash"), metadata, receiveMs));
}));
worker.post("/jobs/:id/complete", wrap(async (req, res) => ok(res, await compute.settle(req.job._id))));
worker.post("/jobs/:id/fail", wrap(async (req, res) => ok(res, await compute.refund(req.job._id, String(req.body.reason || "Worker failure").slice(0, 1000), { lease: req.job.leaseId, metadata: req.body.metadata }))));
worker.use((_req, res) => res.status(404).json({ success: false, message: "Unknown real worker endpoint" }));
router.use("/worker", worker);
module.exports = router;
