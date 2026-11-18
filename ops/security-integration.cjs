"use strict";
// Run with the normal worker stopped. This uses real HTTP, MongoDB, CPU output,
// and local-chain refunds; no fabricated successful computation.
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { execFileSync } = require("child_process");
const root = path.resolve(__dirname, "..");
const users = JSON.parse(fs.readFileSync(path.join(root, "runtime/accounts.json")));
const base = "http://127.0.0.1:5000/api";
const checks = [];
let token, providerToken, key, otherKey, session = crypto.randomUUID();
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function request(route, body, headers = {}, method = "POST") {
  const response = await fetch(base + route, { method, headers: { "Content-Type": "application/json", Connection: "close", ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: response.status, ...(await response.json()) };
}
function expect(response, status, label) { assert.equal(response.status, status, `${label}: ${JSON.stringify(response)}`); checks.push(label); return response.data; }
const consumerHeaders = () => ({ Authorization: `Bearer ${token}` });
const providerHeaders = () => ({ Authorization: `Bearer ${providerToken}` });
const workerHeaders = (job, workerKey = key) => ({ "X-Worker-API-Key": workerKey, "X-Worker-Session": session, ...(job ? { "X-Job-Lease": job.leaseId } : {}) });
async function getJob(id) { return expect(await request(`/jobs/${id}`, undefined, consumerHeaders(), "GET"), 200, "Read own job"); }
async function main() {
  token = (await request("/auth/login", users.consumer)).token;
  providerToken = (await request("/auth/login", users.provider)).token;
  const slots = expect(await request("/gpus?mine=true", undefined, providerHeaders(), "GET"), 200, "Provider lists slots");
  for (const slot of slots) {
    expect(await request(`/gpus/${slot._id}`, { availability: false }, providerHeaders(), "PUT"), 200, "Unlist idle slot for isolated test");
  }
  const gpu = expect(await request("/gpus", {}, providerHeaders()), 201, "Register test slot");
  key = expect(await request(`/gpus/${gpu._id}/worker-key`, { walletAddress: users.provider.walletAddress }, providerHeaders()), 200, "Issue scoped credential").workerApiKey;
  const otherGpu = expect(await request("/gpus", {}, providerHeaders()), 201, "Register second slot");
  otherKey = expect(await request(`/gpus/${otherGpu._id}/worker-key`, { walletAddress: users.provider.walletAddress }, providerHeaders()), 200, "Issue different scoped credential").workerApiKey;
  const cap = JSON.parse(execFileSync("python", [path.join(root, "worker/matrix_workload.py"), "capabilities", "--mode", "real_cpu_test"], { encoding: "utf8" }));
  expect(await request("/worker/heartbeat", { capabilities: cap, walletAddress: users.provider.walletAddress }, workerHeaders()), 200, "Genuine CPU capability heartbeat");
  expect(await request("/worker/heartbeat", { capabilities: cap, walletAddress: users.provider.walletAddress }, { ...workerHeaders(), "X-Worker-Session": crypto.randomUUID() }), 409, "Second live worker session rejected");
  expect(await request("/worker/jobs", undefined, { "X-Worker-API-Key": "wrong" }, "GET"), 401, "Invalid worker key rejected");
  expect(await request("/jobs", { taskType: "shell", input: {} }, consumerHeaders()), 400, "Arbitrary workload rejected");
  let job = expect(await request("/jobs", { taskType: "matrix_multiply", input: { size: 16, seed: 123 }, reservedMinutes: 1 }, consumerHeaders()), 201, "Create unfunded job");
  await sleep(3500);
  assert.equal((await getJob(job._id)).status, "AWAITING_FUNDING"); checks.push("Unfunded job not scheduled");
  const funding = await Promise.all([request(`/jobs/${job._id}/fund`, {}, consumerHeaders()), request(`/jobs/${job._id}/fund`, {}, consumerHeaders())]);
  assert.equal(funding.filter((response) => response.status === 200).length, 1, JSON.stringify(funding)); checks.push("Concurrent funding has exactly one winner");
  for (let attempt = 0; attempt < 30; attempt++) {
    job = await getJob(job._id);
    if (job.status === "ASSIGNED") break;
    await sleep(1000);
  }
  assert.equal(job.status, "ASSIGNED");
  expect(await request(`/worker/jobs/${job._id}/start`, {}, workerHeaders(job, otherKey)), 409, "Other GPU credential cannot start job");
  expect(await request(`/worker/jobs/${job._id}/start`, {}, { ...workerHeaders(job), "X-Job-Lease": "wrong" }), 409, "Wrong lease rejected");
  expect(await request(`/worker/jobs/${job._id}/start`, {}, workerHeaders(job)), 200, "Assigned worker starts job");
  expect(await request(`/worker/jobs/${job._id}/complete`, {}, workerHeaders(job)), 409, "No artifact cannot settle or pay");
  const output = path.join(root, "runtime/security-result.npy");
  const metadata = JSON.parse(execFileSync("python", [path.join(root, "worker/matrix_workload.py"), "compute", "--spec", JSON.stringify(job.spec), "--artifact", output], { encoding: "utf8" }));
  const bytes = fs.readFileSync(output);
  const headers = { ...workerHeaders(job), "Content-Type": "application/octet-stream", "X-Result-Metadata": Buffer.from(JSON.stringify(metadata)).toString("base64") };
  let response = await fetch(base + `/worker/jobs/${job._id}/result`, { method: "POST", headers: { ...headers, "X-Result-Hash": "0".repeat(64) }, body: bytes });
  assert.equal(response.status, 400); checks.push("Wrong artifact hash rejected");
  const wrong = Buffer.from(bytes); wrong.writeFloatLE(10000, wrong.length - 4);
  response = await fetch(base + `/worker/jobs/${job._id}/result`, { method: "POST", headers: { ...headers, "X-Result-Hash": crypto.createHash("sha256").update(wrong).digest("hex") }, body: wrong });
  assert.equal(response.status, 400); checks.push("Hash-consistent numerically incorrect artifact rejected");
  assert.equal((await getJob(job._id)).status, "RUNNING"); checks.push("Rejected result does not complete job");
  const refunded = expect(await request(`/worker/jobs/${job._id}/fail`, { reason: "Intentional tested worker failure" }, workerHeaders(job)), 200, "Worker failure refunds escrow");
  assert.equal(refunded.status, "REFUNDED");
  expect(await request(`/worker/jobs/${job._id}/start`, {}, workerHeaders(job)), 409, "Late worker cannot restart refunded job");
  // Two genuinely funded jobs compete for one fresh worker slot. No computation
  // is claimed: both escrows are actually refunded after observing exclusivity.
  expect(await request("/worker/heartbeat", { capabilities: cap, walletAddress: users.provider.walletAddress }, workerHeaders()), 200, "Refresh worker before concurrent scheduling");
  const competing = [];
  for (let index = 0; index < 2; index++) {
    competing.push(expect(await request("/jobs", { taskType: "matrix_multiply", input: { size: 16, seed: index }, reservedMinutes: 1 }, consumerHeaders()), 201, "Create competing job"));
  }
  await Promise.all(competing.map(async (item) => expect(await request(`/jobs/${item._id}/fund`, {}, consumerHeaders()), 200, "Fund competing job")));
  let observed;
  for (let attempt = 0; attempt < 20; attempt++) {
    observed = await Promise.all(competing.map((item) => getJob(item._id)));
    if (observed.some((item) => item.status === "ASSIGNED")) break;
    await sleep(1000);
  }
  assert.equal(observed.filter((item) => item.status === "ASSIGNED").length, 1);
  assert.equal(observed.filter((item) => item.status === "QUEUED").length, 1);
  checks.push("Two funded jobs cannot reserve the same slot concurrently");
  for (const item of competing) {
    const cancelled = expect(await request(`/jobs/${item._id}/cancel`, {}, consumerHeaders()), 200, "Refund competing test job");
    assert.equal(cancelled.status, "REFUNDED");
  }
  // Leave demo slot available for subsequent worker restart/provisioning.
  for (const slot of [gpu, otherGpu]) await request(`/gpus/${slot._id}`, { availability: false }, providerHeaders(), "PUT");
  for (const slot of slots) await request(`/gpus/${slot._id}`, { availability: true }, providerHeaders(), "PUT");
  fs.mkdirSync(path.join(root, "evidence"), { recursive: true });
  const evidence = { recordedAt: new Date().toISOString(), checks: [...new Set(checks)], refund: { jobId: refunded._id, receipts: refunded.receipts } };
  fs.writeFileSync(path.join(root, "evidence/security-integration.json"), JSON.stringify(evidence, null, 2));
  console.log(`PASS: ${evidence.checks.length} distinct live security/reliability checks`);
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
