/**
 * test/devRoutes.test.js
 * P0-1: development-only routes are gated by ENABLE_DEV_ROUTES and NODE_ENV,
 * job-mutating demo routes require the owning consumer, request-body
 * provider addresses / result hashes are not trusted, and submit-result
 * reports 501. Exercised over real HTTP against app.js with stubbed models
 * and a stubbed blockchain service (no MongoDB, no chain).
 */

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const jwt = require("jsonwebtoken");
const { makeModel } = require("./helpers/inMemoryModels");
const { loadWithStubs, quiet } = require("./helpers/loadWithStubs");
const { isDevRoutesEnabled } = require("../config/devRoutes");

const SECRET = "test-secret-only-for-node-test";
const OWNER = { _id: "u_owner", name: "Owner", email: "o@x.io", role: "CONSUMER" };
const STRANGER = { _id: "u_stranger", name: "Stranger", email: "s@x.io", role: "CONSUMER" };
const PROVIDER = { _id: "u_prov", name: "Prov", email: "p@x.io", role: "PROVIDER",
                   walletAddress: "0x90F79bf6EB2c4f870365E785982E1f101E93b906" };
const ATTACKER_ADDR = "0x15d34AAf54267DB7D7c367839AAf71A00a2C6A65";
const JOB_ID = "656000000000000000000001";

// protect() reads JWT_SECRET at request time, so it must stay set while the
// test servers handle requests (not only while app.js is loaded).
process.env.JWT_SECRET = SECRET;

const token = (u) => jwt.sign({ id: u._id, email: u.email, role: u.role }, SECRET);

function buildApp(env) {
  const saved = { ...process.env };
  Object.assign(process.env, env);
  for (const k of ["ENABLE_DEV_ROUTES", "NODE_ENV"]) if (!(k in env)) delete process.env[k];

  const users = [OWNER, STRANGER, PROVIDER].map((u) => ({ ...u }));
  const gpus = [{ _id: "g1", providerId: PROVIDER._id, gpuModel: "RTX", status: "BUSY", availability: false }];
  const jobs = [{ _id: JOB_ID, consumerId: OWNER._id, gpuId: "g1", status: "ASSIGNED",
                  resultHash: "0x" + "11".repeat(32), blockchainJobId: null }];
  const User = makeModel(users);
  const GPU = makeModel(gpus, { providerId: () => User });
  GPU.GPU_STATUS = { ACTIVE: "ACTIVE", INACTIVE: "INACTIVE", BUSY: "BUSY" };
  const Job = makeModel(jobs, { gpuId: () => GPU, consumerId: () => User });
  Job.JOB_STATUS = { CREATED: "CREATED", QUEUED: "QUEUED", ASSIGNED: "ASSIGNED", RUNNING: "RUNNING",
                     RESULT_UPLOADED: "RESULT_UPLOADED", COMPLETED: "COMPLETED", FAILED: "FAILED", CANCELLED: "CANCELLED" };
  User.ROLES = { CONSUMER: "CONSUMER", PROVIDER: "PROVIDER" };
  const Transaction = makeModel([]);
  Transaction.TX_TYPE = { ESCROW: "ESCROW", PAYMENT_RELEASE: "PAYMENT_RELEASE", REFUND: "REFUND" };
  Transaction.TX_STATUS = { CONFIRMED: "CONFIRMED" };

  const chainCalls = [];
  const rec = (name) => async (...args) => { chainCalls.push({ name, args }); return { txHash: "0xtx_" + name }; };
  class BlockchainUnavailableError extends Error {}
  const blockchain = {
    isAvailable: () => true, initialized: true, operatorWallet: null, demoConsumerWallet: null,
    toBlockchainJobId: (id) => "0x" + String(id).padStart(64, "0"),
    getJob: async () => ({ status: 0, statusLabel: "NONE" }),
    getEscrowBalance: async () => ({ wei: "0", ether: "0.0" }),
    assignJob: rec("assignJob"), verifyResult: rec("verifyResult"),
    releasePayment: rec("releasePayment"), refund: rec("refund"),
    demoRegisterJob: rec("demoRegisterJob"), demoDepositFunds: rec("demoDepositFunds"),
    provider: { getNetwork: async () => ({ name: "stub", chainId: 31337n }) },
  };
  blockchain.BlockchainUnavailableError = BlockchainUnavailableError;

  const app = loadWithStubs("app.js", {
    "models/User.js": User, "models/GPU.js": GPU, "models/Job.js": Job,
    "models/Transaction.js": Transaction, "blockchain/blockchainService.js": blockchain,
  });
  process.env = saved;
  process.env.JWT_SECRET = SECRET;
  return { app, jobs, gpus, chainCalls };
}

async function withServer(app, fn) {
  const server = app.listen(0);
  await new Promise((r) => server.once("listening", r));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    return await quiet(() => fn(async (method, path, { user, body } = {}) => {
      const res = await fetch(base + path, {
        method,
        headers: { "content-type": "application/json", ...(user ? { authorization: `Bearer ${token(user)}` } : {}) },
        body: body ? JSON.stringify(body) : undefined,
      });
      let json = null; try { json = await res.json(); } catch (_) { /* no body */ }
      return { status: res.status, body: json };
    }));
  } finally {
    await new Promise((r) => server.close(r));
  }
}

test("isDevRoutesEnabled: off by default, on only with the flag, never in production", () => {
  assert.equal(isDevRoutesEnabled({}), false);
  assert.equal(isDevRoutesEnabled({ ENABLE_DEV_ROUTES: "false" }), false);
  assert.equal(isDevRoutesEnabled({ ENABLE_DEV_ROUTES: "1" }), false);
  assert.equal(isDevRoutesEnabled({ ENABLE_DEV_ROUTES: "true" }), true);
  assert.equal(isDevRoutesEnabled({ ENABLE_DEV_ROUTES: "true", NODE_ENV: "development" }), true);
  assert.equal(isDevRoutesEnabled({ ENABLE_DEV_ROUTES: "true", NODE_ENV: "production" }), false);
});

test("default (no flag): dev routes are not mounted (404), health reports disabled", async () => {
  const { app } = buildApp({});
  await withServer(app, async (req) => {
    assert.equal((await req("POST", "/api/dev/scheduler/run", { user: OWNER })).status, 404);
    assert.equal((await req("POST", `/api/dev/blockchain/refund/${JOB_ID}`, { user: OWNER })).status, 404);
    assert.equal((await req("GET", "/api/dev/blockchain/status", { user: OWNER })).status, 404);
    const health = await req("GET", "/health");
    assert.equal(health.body.devRoutesEnabled, false);
    assert.equal(health.body.scheduler.devTrigger, null);
  });
});

test("production: dev routes stay unmounted even with ENABLE_DEV_ROUTES=true", async () => {
  const { app } = buildApp({ ENABLE_DEV_ROUTES: "true", NODE_ENV: "production" });
  await withServer(app, async (req) => {
    assert.equal((await req("POST", "/api/dev/scheduler/run", { user: OWNER })).status, 404);
    assert.equal((await req("POST", `/api/dev/blockchain/refund/${JOB_ID}`, { user: OWNER })).status, 404);
  });
});

test("enabled in development: routes mounted and still require authentication", async () => {
  const { app } = buildApp({ ENABLE_DEV_ROUTES: "true", NODE_ENV: "development" });
  await withServer(app, async (req) => {
    assert.equal((await req("POST", "/api/dev/scheduler/run")).status, 401);
    assert.equal((await req("GET", "/api/dev/blockchain/status", { user: OWNER })).status, 200);
  });
});

const ENABLED = { ENABLE_DEV_ROUTES: "true", NODE_ENV: "development" };

test("refund/release/demo-escrow: another consumer or a provider gets 403 and nothing happens on-chain", async () => {
  const { app, jobs, chainCalls } = buildApp(ENABLED);
  await withServer(app, async (req) => {
    for (const route of ["refund", "release-payment", "demo-escrow", "assign", "verify"]) {
      for (const user of [STRANGER, PROVIDER]) {
        const r = await req("POST", `/api/dev/blockchain/${route}/${JOB_ID}`, { user });
        assert.equal(r.status, 403, `${route} as ${user.role}/${user._id}`);
      }
    }
  });
  assert.deepEqual(chainCalls, []);
  assert.equal(jobs[0].status, "ASSIGNED");
});

test("owner refund works, marks the job CANCELLED, and releases the BUSY GPU", async () => {
  const { app, jobs, gpus, chainCalls } = buildApp(ENABLED);
  await withServer(app, async (req) => {
    const r = await req("POST", `/api/dev/blockchain/refund/${JOB_ID}`, { user: OWNER });
    assert.equal(r.status, 200);
  });
  assert.deepEqual(chainCalls.map((c) => c.name), ["refund"]);
  assert.equal(jobs[0].status, "CANCELLED");
  assert.equal(gpus[0].status, "ACTIVE");
  assert.equal(gpus[0].availability, true);
});

test("owner release-payment works and releases the BUSY GPU", async () => {
  const { app, jobs, gpus, chainCalls } = buildApp(ENABLED);
  await withServer(app, async (req) => {
    assert.equal((await req("POST", `/api/dev/blockchain/release-payment/${JOB_ID}`, { user: OWNER })).status, 200);
  });
  assert.deepEqual(chainCalls.map((c) => c.name), ["releasePayment"]);
  assert.equal(jobs[0].status, "COMPLETED");
  assert.equal(gpus[0].status, "ACTIVE");
});

test("assign ignores a request-body providerAddress and uses the assigned GPU provider's wallet", async () => {
  const { app, chainCalls } = buildApp(ENABLED);
  await withServer(app, async (req) => {
    const r = await req("POST", `/api/dev/blockchain/assign/${JOB_ID}`, { user: OWNER, body: { providerAddress: ATTACKER_ADDR } });
    assert.equal(r.status, 200);
  });
  assert.equal(chainCalls.length, 1);
  assert.equal(chainCalls[0].args[1], PROVIDER.walletAddress);
});

test("verify ignores a request-body expectedResultHash and uses the stored resultHash", async () => {
  const { app, jobs, chainCalls } = buildApp(ENABLED);
  await withServer(app, async (req) => {
    const r = await req("POST", `/api/dev/blockchain/verify/${JOB_ID}`, { user: OWNER, body: { expectedResultHash: "0x" + "ff".repeat(32) } });
    assert.equal(r.status, 200);
  });
  assert.equal(chainCalls[0].name, "verifyResult");
  assert.equal(chainCalls[0].args[1], jobs[0].resultHash);
});

test("submit-result returns 501 and makes no chain call", async () => {
  const { app, chainCalls } = buildApp(ENABLED);
  await withServer(app, async (req) => {
    const r = await req("POST", `/api/dev/blockchain/submit-result/${JOB_ID}`, { user: OWNER, body: { resultHash: "0x01" } });
    assert.equal(r.status, 501);
  });
  assert.deepEqual(chainCalls, []);
});

test("on-chain job view: unrelated user 403; owner and assigned provider 200", async () => {
  const { app } = buildApp(ENABLED);
  await withServer(app, async (req) => {
    assert.equal((await req("GET", `/api/dev/blockchain/job/${JOB_ID}`, { user: STRANGER })).status, 403);
    assert.equal((await req("GET", `/api/dev/blockchain/job/${JOB_ID}`, { user: OWNER })).status, 200);
    assert.equal((await req("GET", `/api/dev/blockchain/job/${JOB_ID}`, { user: PROVIDER })).status, 200);
  });
});

test("owner demo-escrow still works when enabled (register + deposit)", async () => {
  const { app, jobs, chainCalls } = buildApp({ ...ENABLED, BLOCKCHAIN_DEMO_MODE: "true" });
  const saved = process.env.BLOCKCHAIN_DEMO_MODE;
  process.env.BLOCKCHAIN_DEMO_MODE = "true";           // read at request time by the route
  try {
    await withServer(app, async (req) => {
      const r = await req("POST", `/api/dev/blockchain/demo-escrow/${JOB_ID}`, { user: OWNER });
      assert.equal(r.status, 200);
    });
  } finally {
    if (saved === undefined) delete process.env.BLOCKCHAIN_DEMO_MODE; else process.env.BLOCKCHAIN_DEMO_MODE = saved;
  }
  assert.deepEqual(chainCalls.map((c) => c.name), ["demoRegisterJob", "demoDepositFunds"]);
  assert.ok(jobs[0].escrowAmountWei);
});
