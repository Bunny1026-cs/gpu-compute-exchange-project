"use strict";
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { performance } = require("perf_hooks");
const runtime = path.resolve(__dirname, "../runtime");
const users = JSON.parse(fs.readFileSync(path.join(runtime, "accounts.json")));
const base = process.env.BACKEND_URL || "http://127.0.0.1:5000/api";
const evidenceDir = path.resolve(process.env.EVIDENCE_DIR || path.join(__dirname, "../evidence"));
const samples = [];
async function api(route, body, token, method = "POST", expected = 200) {
  const response = await fetch(base + route, { method, headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const data = await response.json();
  assert.equal(response.status, expected, `${route}: ${JSON.stringify(data)}`);
  return data;
}
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function main() {
  const token = (await api("/auth/login", users.consumer)).token;
  const providerToken = (await api("/auth/login", users.provider)).token;
  const config = (await api("/compute/config", null, token, "GET")).data;
  assert.equal(config.executionMode, "real_cpu_test", "This integration run is explicitly CPU development testing");
  const count = Number(process.argv[2] || 5);
  for (let index = 0; index < count; index++) {
    const t0 = performance.now();
    const job = (await api("/jobs", { taskType: "matrix_multiply", input: { size: 128, seed: 42 + index }, reservedMinutes: 1 }, token, "POST", 201)).data;
    assert.equal(job.status, "AWAITING_FUNDING");
    await api(`/jobs/${job._id}/fund`, {}, providerToken, "POST", 403);
    const funded = (await api(`/jobs/${job._id}/fund`, {}, token)).data;
    assert.equal(funded.status, "QUEUED");
    let current;
    const deadline = performance.now() + 180000;
    do {
      current = (await api(`/jobs/${job._id}`, null, token, "GET")).data;
      if (["FAILED", "REFUNDED", "CANCELLED"].includes(current.status)) throw new Error(JSON.stringify(current));
      if (current.status === "COMPLETED") break;
      if (performance.now() > deadline) throw new Error(`Timed out: ${JSON.stringify(current)}`);
      await delay(1000);
    } while (true);
    assert.equal(current.verification.verified, true);
    assert.equal(current.paymentWei, current.escrowAmountWei);
    assert.equal(current.resultMetadata.spec.executionMode, "real_cpu_test");
    assert.ok(current.receipts.some((receipt) => receipt.action === "PaymentReleased"));
    assert.ok(current.receipts.some((receipt) => receipt.action === "ResultSubmitted"));
    const artifact = await fetch(base + `/jobs/${job._id}/artifact`, { headers: { Authorization: `Bearer ${token}` } });
    assert.equal(artifact.status, 200);
    const bytes = Buffer.from(await artifact.arrayBuffer());
    assert.equal(crypto.createHash("sha256").update(bytes).digest("hex"), current.resultHash);
    const before = current.receipts.length;
    let retried;
    for (let attempt = 0; attempt < 30; attempt++) {
      const response = await fetch(base + `/jobs/${job._id}/reconcile`, { method: "POST", headers: { Authorization: `Bearer ${token}` } });
      const payload = await response.json();
      if (response.status === 409 && payload.message.includes("operation in progress")) { await delay(1000); continue; }
      assert.equal(response.status, 200, JSON.stringify(payload));
      retried = payload.data;
      break;
    }
    assert.ok(retried, "Settlement retry should finish after the active operation releases its lock");
    assert.equal(retried.status, "COMPLETED");
    assert.equal(retried.receipts.length, before, "Duplicate settlement must not add payments");
    const gpus = (await api("/gpus?mine=true", null, providerToken, "GET")).data;
    assert.equal(gpus.find((gpu) => gpu._id === current.gpuId._id).activeJob, null);
    const sample = { jobId: job._id, endToEndMs: performance.now() - t0, resultHash: current.resultHash,
      executionMode: "real_cpu_test", metadata: current.resultMetadata, receipts: current.receipts,
      paymentWei: current.paymentWei, verification: current.verification,
      queueMs: new Date(current.assignedAt) - new Date(current.fundedAt) };
    samples.push(sample);
    fs.mkdirSync(evidenceDir, { recursive: true });
    fs.writeFileSync(path.join(evidenceDir, "cpu-integration.json"), JSON.stringify({
      recordedAt: new Date().toISOString(), environment: "Laptop 1; CPU; local Hardhat; no GPU claim", samples,
    }, null, 2));
    console.log(`PASS ${index + 1}/${count}: ${job._id}, genuine result and confirmed ${current.paymentWei} wei payment`);
  }
  const cancelled = (await api("/jobs", { taskType: "matrix_multiply", input: { size: 64, seed: 10 }, reservedMinutes: 1, requirements: { requiredGpuMemory: 99999 } }, token, "POST", 201)).data;
  await api(`/jobs/${cancelled._id}/fund`, {}, token);
  const refunded = (await api(`/jobs/${cancelled._id}/cancel`, {}, token)).data;
  assert.equal(refunded.status, "REFUNDED");
  assert.ok(refunded.receipts.some((receipt) => receipt.action === "RefundIssued"));
  await api(`/jobs/${cancelled._id}/fund`, {}, token, "POST", 409);
  fs.writeFileSync(path.join(evidenceDir, "cpu-refund.json"), JSON.stringify({ jobId: refunded._id, status: refunded.status, receipts: refunded.receipts }, null, 2));
  console.log("PASS: incompatible GPU requirement stayed queued; cancellation confirmed actual refund; refunded job cannot fund again");
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
