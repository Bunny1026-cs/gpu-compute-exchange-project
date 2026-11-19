const crypto = require("node:crypto");
const mongoose = require("mongoose");
const { ethers } = require("ethers");
const Job = require("../models/Job");
const GPU = require("../models/GPU");
const batch = require("../services/batch");
const compute = require("../services/realCompute");
const bc = require("../blockchain/blockchainService");
const storage = require("../services/artifactStorage");
const { decide } = require("../services/reviews");
const Agent = mongoose.model("BatchAgent", new mongoose.Schema({
  providerId: mongoose.Schema.Types.ObjectId, codeHash: String, expires: Date, keyHash: String, wallet: String,
}));
module.exports = function mount(router, { provider, consumer, protect, owner, wrap, ok }) {
  router.post("/agents/code", ...provider, wrap(async (req,res) => {
    const code = crypto.randomBytes(8).toString("hex").toUpperCase();
    const expires = new Date(Date.now()+300000);
    await Agent.create({providerId:req.user._id, codeHash:compute.hash(code), expires});
    ok(res,{code,expires});
  }));
  router.post("/agents/pair", wrap(async(req,res) => {
    const {wallet,code} = req.body;
    if (!ethers.isAddress(wallet) || [ethers.ZeroAddress,bc.operatorWallet?.address,bc.demoConsumerWallet?.address].some(a=>a?.toLowerCase()===wallet.toLowerCase())) throw compute.fail("Separate provider wallet required");
    const key = crypto.randomBytes(32).toString("hex");
    const agent = await Agent.findOneAndUpdate({ codeHash:compute.hash(String(code).toUpperCase()),expires:{$gt:new Date()} },
      {$set:{wallet,keyHash:compute.hash(key)},$unset:{codeHash:1,expires:1}});
    if (!agent) throw compute.fail("Expired or used pairing code",403);
    ok(res,{key});
  }));
  router.post("/agents/devices",wrap(async(req,res)=>{
    const secret = req.get("X-Agent-Key") || "";
    const agent = await Agent.findOne({keyHash:compute.hash(secret)});
    if (!agent) throw compute.fail("Invalid paired agent",403);
    const cap = req.body;
    if (typeof cap.deviceKey !== "string" || !/^[a-zA-Z0-9-]{1,90}$/.test(cap.deviceKey) ||
      typeof cap.gpuModel !== "string" || !Number.isFinite(cap.gpuMemory) || cap.gpuMemory < 0 ||
      !["real_cpu_test","real_gpu"].includes(cap.executionMode)) throw compute.fail("Invalid discovery record");
    if (cap.executionMode === "real_cpu_test" && process.env.FINAL_DEMO !== "false") throw compute.fail("CPU pilot disabled");
    const key = crypto.createHmac("sha256",secret).update(cap.deviceKey).digest("hex");
    const slot = await GPU.findOneAndUpdate({agentId:agent._id, deviceKey:cap.deviceKey}, {
      $setOnInsert:{providerId:agent.providerId, workerKeyHash:compute.hash(key),providerWallet:agent.wallet,
        availability:false, pricePerHour:0, rateWeiPerMinute:process.env.RATE_WEI_PER_MINUTE || "1000000000000000"},
      $set:{capabilities:cap,gpuModel:cap.gpuModel,gpuMemory:cap.gpuMemory,cudaVersion:cap.cudaVersion || "0",executionMode:cap.executionMode}
    },{upsert:true,returnDocument:"after"});
    ok(res,{id:slot._id,key});
  }));
  router.put("/agents/slots/:id",...provider,wrap(async(req,res)=>{
    if (!batch.validRate(req.body.rate) || typeof req.body.enabled !== "boolean") throw compute.fail("Enter a positive integer wei/min rate");
    const slot = await GPU.findOneAndUpdate({_id:req.params.id,providerId:req.user._id,agentId:{$exists:true},retiredAt:null},
      {$set:{rateWeiPerMinute:req.body.rate,availability:req.body.enabled}},{returnDocument:"after"});
    if (!slot) throw compute.fail("Device not found",404);
    ok(res,slot);
  }));
  router.post("/batch/jobs",...consumer,wrap(async(req,res)=>ok(res,await batch.create(req.user,req.body))));
  router.post("/jobs/:id/quote",...consumer,wrap(async(req,res)=>{
    await owner(req);
    ok(res,await compute.locked(req.params.id,async job=>{
      if (!batch.isBatch(job) || job.chainInstance || !["DRAFT","AWAITING_FUNDING"].includes(job.status)) throw compute.fail("Quote already frozen",409);
      return batch.quote(job);
    }));
  }));
  router.post("/jobs/:id/repeat",...consumer,wrap(async(req,res)=>{
    const job=await owner(req);
    if (!batch.isBatch(job)) throw compute.fail("Script job required");
    const {scriptSource}=await Job.findById(job._id).select("+scriptSource");
    ok(res,await batch.create(req.user,{...job.spec,source:scriptSource}));
  }));
  router.post("/jobs/:id/review",...consumer,wrap(async(req,res)=>{
    await owner(req); ok(res,await decide(req.params.id,req.body.decision,req.body.reason));
  }));
  router.get("/jobs/:id/outputs/:name",protect,wrap(async(req,res)=>{
    const job=await owner(req,true);
    if (!batch.isBatch(job) || !job.verification?.files?.some(f=>f.name===req.params.name)) throw compute.fail("Output unavailable",404);
    const files=JSON.parse(await storage.readVerified(job));
    res.attachment(req.params.name).type("application/octet-stream").send(Buffer.from(files.find(f=>f.name===req.params.name).data,"base64"));
  }));
};
