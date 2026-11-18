"use strict";
// Isolated live recovery check. Stop normal worker first. Only the dedicated
// test job's lease is accelerated; the real periodic cycle performs the refund.
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const mongoose = require("../backend/node_modules/mongoose");
const root = path.resolve(__dirname, "..");
const accounts = JSON.parse(fs.readFileSync(path.join(root, "runtime/accounts.json")));
const base = "http://127.0.0.1:5000/api";
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function api(route, body, token, method = "POST", extra = {}) {
  const response = await fetch(base + route, { method, headers: { "Content-Type": "application/json", Connection: "close",
    ...(token ? { Authorization: `Bearer ${token}` } : {}), ...extra }, body: body === undefined ? undefined : JSON.stringify(body) });
  const result = await response.json();
  if (!response.ok) throw new Error(`${route}: ${JSON.stringify(result)}`);
  return result.data || result;
}
async function main() {
  const consumer = (await api("/auth/login", accounts.consumer)).token;
  const provider = (await api("/auth/login", accounts.provider)).token;
  const slots = await api("/gpus?mine=true", undefined, provider, "GET");
  for (const slot of slots) await api(`/gpus/${slot._id}`, { availability: false }, provider, "PUT");
  const slot = await api("/gpus", {}, provider);
  const credential = await api(`/gpus/${slot._id}/worker-key`, { walletAddress: accounts.provider.walletAddress }, provider);
  const cap = JSON.parse(require("child_process").execFileSync("python", [path.join(root, "worker/matrix_workload.py"), "capabilities", "--mode", "real_cpu_test"], { encoding: "utf8" }));
  await api("/worker/heartbeat", { capabilities: cap, walletAddress: accounts.provider.walletAddress }, null, "POST", {
    "X-Worker-API-Key": credential.workerApiKey, "X-Worker-Session": crypto.randomUUID(),
  });
  let job = await api("/jobs", { taskType: "matrix_multiply", input: { size: 16, seed: 7 }, reservedMinutes: 1 }, consumer);
  await api(`/jobs/${job._id}/fund`, {}, consumer);
  for (let index = 0; index < 30; index++) {
    job = await api(`/jobs/${job._id}`, undefined, consumer, "GET");
    if (job.status === "ASSIGNED") break;
    await pause(1000);
  }
  assert.equal(job.status, "ASSIGNED");
  await mongoose.connect("mongodb://127.0.0.1:27017/bdgce_real_demo");
  try {
    await mongoose.connection.collection("jobs").updateOne({ _id: new mongoose.Types.ObjectId(job._id), status: "ASSIGNED" }, { $set: { leaseExpiresAt: new Date(0) } });
  } finally { await mongoose.disconnect(); }
  for (let index = 0; index < 30; index++) {
    job = await api(`/jobs/${job._id}`, undefined, consumer, "GET");
    if (job.status === "REFUNDED") break;
    await pause(1000);
  }
  assert.equal(job.status, "REFUNDED");
  assert.ok(job.receipts.some((receipt) => receipt.action === "RefundIssued"));
  const updated = await api("/gpus?mine=true", undefined, provider, "GET");
  assert.equal(updated.find((item) => item._id === slot._id).activeJob, null);
  await api(`/gpus/${slot._id}`, { availability: false }, provider, "PUT");
  for (const old of slots) await api(`/gpus/${old._id}`, { availability: old.availability }, provider, "PUT");
  fs.writeFileSync(path.join(root, "evidence/lease-recovery.json"), JSON.stringify({ recordedAt: new Date().toISOString(),
    method: "Dedicated test lease expiration accelerated in MongoDB; actual backend cycle and real chain refund",
    jobId: job._id, status: job.status, reason: job.error, receipts: job.receipts, reservationReleased: true }, null, 2));
  console.log("PASS: periodic cycle refunded expired lease and released reservation");
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
