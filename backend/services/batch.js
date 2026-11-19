"use strict";
const Job = require("../models/Job");
const GPU = require("../models/GPU");
const profiles = require("../../worker/profiles.json");
const { hash } = require("./artifactStorage");
const bc = require("../blockchain/blockchainService");
const invalid = message => Object.assign(new Error(message), { statusCode: 400 });
const isBatch = job => job.taskType === "python_batch";
const validRate = value => typeof value === "string" && /^[1-9]\d{0,35}$/.test(value);
function specification(body) {
  const { source, profile, args = [], outputs, seconds, minVramGiB = 0 } = body;
  if (typeof source !== "string" || !source.trim() || Buffer.byteLength(source) > 49152) throw invalid("Script must be 1–49152 UTF-8 bytes");
  if (!Object.hasOwn(profiles, profile) || !Number.isInteger(seconds) || seconds < 1 || seconds > 600 ||
      !Number.isFinite(minVramGiB) || minVramGiB < 0 || minVramGiB > 1024 ||
      (profile === "python-cpu" && (minVramGiB !== 0 || process.env.FINAL_DEMO !== "false"))) throw invalid("Invalid profile, runtime limit or VRAM");
  if (!Array.isArray(args) || args.length > 32 || args.some(a => typeof a !== "string" || a.includes("\0") || a.length > 256)) throw invalid("Use up to 32 string arguments");
  if (!Array.isArray(outputs) || !outputs.length || outputs.length > 8 || new Set(outputs).size !== outputs.length ||
      outputs.some(s => typeof s !== "string" || !/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,79}$/.test(s))) throw invalid("Declare 1–8 unique output filenames");
  return { profile, image: profiles[profile], args, seconds, outputs, minVramGiB, scriptHash: hash(source),
    executionMode: profile === "python-cpu" ? "real_cpu_test" : "real_gpu" };
}
function eligible(spec, excluded = []) {
  return { agentId: { $exists: true }, retiredAt: null, availability: true, status: "ACTIVE", activeJob: null,
    lastHeartbeat: { $gte: new Date(Date.now() - 30000) }, executionMode: spec.executionMode,
    "capabilities.testedImage": spec.image, gpuMemory: { $gte: spec.minVramGiB }, _id: { $nin: excluded } };
}
async function candidate(job, quoted = true) {
  if (job.spec.executionMode === "real_cpu_test" && process.env.FINAL_DEMO !== "false") return undefined;
  const pool = await GPU.find(eligible(job.spec, job.rejectedSlots)).lean();
  return pool.filter(g => validRate(g.rateWeiPerMinute) && (!quoted || BigInt(g.rateWeiPerMinute) <= BigInt(job.rateWeiPerMinute)))
    .sort((a,b) => BigInt(a.rateWeiPerMinute) < BigInt(b.rateWeiPerMinute) ? -1 :
      BigInt(a.rateWeiPerMinute) > BigInt(b.rateWeiPerMinute) ? 1 : String(a._id).localeCompare(String(b._id)))[0];
}
async function quote(job) {
  const slot = await candidate(job, false);
  job.status = slot ? "AWAITING_FUNDING" : "DRAFT";
  job.rateWeiPerMinute = slot?.rateWeiPerMinute;
  job.escrowAmountWei = slot ? (BigInt(slot.rateWeiPerMinute) * BigInt(job.reservedMinutes)).toString() : undefined;
  await job.save();
  return Job.findById(job._id);
}
async function create(user, body) {
  const spec = specification(body);
  const job = new Job({ protocol: "real", consumerId: user._id, taskType: "python_batch", spec, scriptSource: body.source,
    input: { requirements: {} }, specHash: hash(JSON.stringify({ spec, requirements: {} })), reservedMinutes: Math.ceil(spec.seconds / 60), price: 0 });
  job.blockchainJobId = bc.toBlockchainJobId(job._id);
  return quote(job);
}
function checkBundle(bytes, spec) {
  let files;
  try { files = JSON.parse(bytes.toString()); } catch { throw invalid("Malformed output bundle"); }
  if (!Array.isArray(files) || files.length !== spec.outputs.length) throw invalid("Incorrect output count");
  let total = 0;
  return files.map((file, index) => {
    if (file?.name !== spec.outputs[index] || typeof file.data !== "string") throw invalid("Unexpected output");
    const data = Buffer.from(file.data, "base64");
    total += data.length;
    if (total > 2 * 1024 * 1024) throw invalid("Outputs exceed 2 MiB");
    if (data.toString("base64") !== file.data || hash(data) !== file.sha256) throw invalid("Output digest mismatch");
    return { name: file.name, sha256: file.sha256, bytes: data.length };
  });
}
module.exports = { isBatch, specification, candidate, eligible, create, quote, checkBundle, validRate, profiles };
