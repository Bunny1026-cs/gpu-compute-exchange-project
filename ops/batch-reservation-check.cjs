"use strict";
// Synthetic GPU reports exercise the scheduler only. No GPU execution is claimed.
const assert = require("node:assert/strict");
const { randomUUID } = require("node:crypto");
const accounts = require("../runtime/accounts.json");
const profiles = require("../worker/profiles.json");
const base = process.env.BACKEND_URL || "http://127.0.0.1:5000/api";
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
async function request(route, method, body, headers = {}, expected = 200) {
  const response = await fetch(base + route, { method, headers: { "Content-Type": "application/json", ...headers },
    body: body && JSON.stringify(body) });
  const payload = await response.json();
  assert.equal(response.status, expected, route + ": " + (payload.message || response.status));
  return payload;
}
async function login(role) {
  const result = await request("/auth/login", "POST", accounts[role]);
  return { Authorization: "Bearer " + result.token };
}
async function main() {
  const provider = await login("provider");
  const consumer = await login("consumer");
  const wallet = accounts.provider.walletAddress;
  const { data: { code } } = await request("/agents/code", "POST", {}, provider);
  const { data: agent } = await request("/agents/pair", "POST", { code, wallet });
  await request("/agents/pair", "POST", { code, wallet }, {}, 403);
  const slots = [];
  const jobs = [];
  let timer;
  async function share(slot, enabled) {
    await request("/agents/slots/" + slot.id, "PUT", { enabled, rate: "1" }, provider);
  }
  async function beat(slot) {
    await request("/worker/heartbeat", "POST", { capabilities: slot.cap, walletAddress: wallet }, slot.headers);
  }
  async function submit() {
    const { data } = await request("/batch/jobs", "POST", { profile: "pytorch-cuda", source: "# scheduler fixture\npass",
      outputs: ["fixture.txt"], minVramGiB: 512, seconds: 2 }, consumer);
    jobs.push(data._id);
    return data;
  }
  async function reserved(slot, id) {
    for (let i = 0; i < 40; i++) {
      const { data } = await request("/worker/jobs", "GET", null, slot.headers);
      assert.ok(data.length <= 1, "Device has at most one reservation");
      if (data[0]?._id === id) return data[0];
      await delay(500);
    }
    throw new Error("Fixture reservation timed out");
  }
  try {
    for (const deviceKey of ["fixture-A", "fixture-B"]) {
      const cap = { deviceKey, gpuModel: "SCHEDULER TEST FIXTURE", gpuMemory: 512, executionMode: "real_gpu",
        testedImage: profiles["pytorch-cuda"], computeCapability: [8, 0], cudaVersion: "12.4" };
      const { data } = await request("/agents/devices", "POST", cap, { "X-Agent-Key": agent.key });
      const slot = { id: data.id, cap, headers: { "X-Worker-API-Key": data.key, "X-Worker-Session": randomUUID() } };
      slots.push(slot);
      await beat(slot);
    }
    timer = setInterval(() => Promise.all(slots.map(beat)).catch(console.error), 8000);
    const [a, b] = slots;
    await share(a, true);
    const first = await submit();
    await request("/jobs/" + first._id + "/fund", "POST", {}, consumer);
    const old = await reserved(a, first._id);
    assert.equal(old.status, "QUEUED");
    assert.ok(!old.receipts.some(r => r.action === "JobAssigned"));
    const stale = { ...a.headers, "X-Job-Lease": old.leaseId };
    await share(b, true);
    await request("/worker/jobs/" + first._id + "/ready", "POST", { ready: false }, stale);
    const recovered = await reserved(b, first._id);
    assert.notEqual(recovered.leaseId, old.leaseId);
    await request("/worker/jobs/" + first._id + "/source", "GET", null, stale, 409);
    await request("/worker/jobs/" + first._id + "/result", "POST", {}, stale, 409);
    const second = await submit();
    await request("/jobs/" + second._id + "/fund", "POST", {}, consumer);
    await reserved(a, second._id);
    assert.equal((await submit()).status, "DRAFT", "Two busy devices cannot quote another job");
    const valid = { ...b.headers, "X-Job-Lease": recovered.leaseId };
    await request("/worker/jobs/" + first._id + "/ready", "POST", { ready: true }, valid);
    for (let i = 0; i < 40; i++) {
      if ((await reserved(b, first._id)).status === "ASSIGNED") break;
      await delay(500);
    }
    await request("/worker/jobs/" + first._id + "/start", "POST", {}, valid);
    const { data: refund } = await request("/worker/jobs/" + first._id + "/fail", "POST", { reason: "Scheduler fixture completed" }, valid);
    assert.equal(refund.status, "REFUNDED");
    assert.equal(refund.receipts.filter(r => r.action === "RefundIssued").length, 1);
    console.log("PASS single-use pairing, readiness failover, stale lease isolation, exclusive reservations, draft and assigned refund (synthetic devices)");
  } finally {
    clearInterval(timer);
    for (const id of jobs) await request("/jobs/" + id + "/cancel", "POST", {}, consumer).catch(e => console.error(e.message));
    for (const slot of slots) {
      await share(slot, false);
      await request("/gpus/" + slot.id, "DELETE", null, provider);
    }
  }
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
