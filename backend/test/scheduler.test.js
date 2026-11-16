/**
 * test/scheduler.test.js
 * P0-3: scheduler concurrency, conditional job claim, and GPU-leak prevention.
 * Runs the real scheduler/scheduler.js against in-memory models.
 */

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { makeModel } = require("./helpers/inMemoryModels");
const { loadWithStubs, quiet } = require("./helpers/loadWithStubs");

const JOB_STATUS = Object.freeze({
  CREATED: "CREATED", QUEUED: "QUEUED", ASSIGNED: "ASSIGNED", RUNNING: "RUNNING",
  RESULT_UPLOADED: "RESULT_UPLOADED", COMPLETED: "COMPLETED", FAILED: "FAILED", CANCELLED: "CANCELLED",
});
const GPU_STATUS = Object.freeze({ ACTIVE: "ACTIVE", INACTIVE: "INACTIVE", BUSY: "BUSY" });

const JOB_A = "656000000000000000000001";
const JOB_B = "656000000000000000000002";

function gpu(id, price, extra = {}) {
  return { _id: id, providerId: `p_${id}`, gpuModel: `GPU-${id}`, gpuMemory: 24, cudaVersion: "12.2",
           pricePerHour: price, availability: true, status: GPU_STATUS.ACTIVE, ...extra };
}
function job(id, createdAt, extra = {}) {
  return { _id: id, consumerId: "c1", status: JOB_STATUS.QUEUED, gpuId: null, createdAt, input: null, ...extra };
}

/** Build a scheduler instance over fresh in-memory stores. */
function setup({ jobs, gpus, users = [], blockchain } = {}) {
  const Job = makeModel(jobs);  Job.JOB_STATUS = JOB_STATUS;
  const GPU = makeModel(gpus);  GPU.GPU_STATUS = GPU_STATUS;
  const User = makeModel(users);
  const bc = blockchain || {
    isAvailable: () => false,
    toBlockchainJobId: (id) => "0x" + String(id).padStart(64, "0"),
  };
  const scheduler = loadWithStubs("scheduler/scheduler.js", {
    "models/Job.js": Job, "models/GPU.js": GPU, "models/User.js": User,
    "blockchain/blockchainService.js": bc,
  });
  return { scheduler, Job, GPU, jobs, gpus };
}

function busyWithoutJob(jobs, gpus) {
  return gpus.filter((g) => g.status === GPU_STATUS.BUSY &&
    !jobs.some((j) => String(j.gpuId) === String(g._id) &&
      [JOB_STATUS.ASSIGNED, JOB_STATUS.RUNNING, JOB_STATUS.RESULT_UPLOADED].includes(j.status)));
}

test("single cycle assigns the lowest-priced compatible GPU", async () => {
  const s = setup({ jobs: [job(JOB_A, 1)], gpus: [gpu("g1", 50), gpu("g2", 80)] });
  const r = await quiet(() => s.scheduler.runSchedulerCycle());
  assert.equal(r.assigned, 1);
  assert.equal(s.jobs[0].status, JOB_STATUS.ASSIGNED);
  assert.equal(s.jobs[0].gpuId, "g1");
  assert.deepEqual(busyWithoutJob(s.jobs, s.gpus), []);
});

test("overlapping cycles in one process: the second is skipped, no double allocation", async () => {
  // Offsets that reproduced the original race (audit: 5–15 ms) and beyond.
  for (const offsetMs of [0, 1, 2, 3, 5, 8, 10, 15, 20]) {
    const s = setup({ jobs: [job(JOB_A, 1)], gpus: [gpu("g1", 50), gpu("g2", 80)] });
    const [r1, r2] = await quiet(() => Promise.all([
      s.scheduler.runSchedulerCycle(),
      new Promise((res) => setTimeout(res, offsetMs)).then(() => s.scheduler.runSchedulerCycle()),
    ]));
    assert.equal(r1.assigned + r2.assigned, 1, `offset ${offsetMs}: exactly one assignment`);
    assert.equal(s.jobs[0].gpuId, "g1", `offset ${offsetMs}: cheapest GPU kept`);
    assert.equal(s.gpus.filter((g) => g.status === GPU_STATUS.BUSY).length, 1, `offset ${offsetMs}: one BUSY GPU`);
    assert.deepEqual(busyWithoutJob(s.jobs, s.gpus), [], `offset ${offsetMs}: no leaked GPU`);
  }
});

test("a cycle triggered while another runs reports cycleSkipped", async () => {
  const s = setup({ jobs: [job(JOB_A, 1)], gpus: [gpu("g1", 50)] });
  const [r1, r2] = await quiet(() => Promise.all([s.scheduler.runSchedulerCycle(), s.scheduler.runSchedulerCycle()]));
  assert.equal(r1.cycleSkipped, undefined);
  assert.equal(r2.cycleSkipped, true);
});

test("job claimed by another writer after the read: GPU is released, job keeps the other GPU", async () => {
  // Simulates a second scheduler process: the job is assigned to g2 between
  // this cycle's read and its conditional job claim.
  const s = setup({ jobs: [job(JOB_A, 1)], gpus: [gpu("g1", 50), gpu("g2", 80)] });
  const realGpuClaim = s.GPU.findOneAndUpdate;
  s.GPU.findOneAndUpdate = async (filter, update, opts) => {
    const out = await realGpuClaim(filter, update, opts);
    if (out && filter.status === GPU_STATUS.ACTIVE && String(filter._id) === "g1") {
      Object.assign(s.gpus[1], { status: GPU_STATUS.BUSY, availability: false });
      Object.assign(s.jobs[0], { status: JOB_STATUS.ASSIGNED, gpuId: "g2" });
    }
    return out;
  };
  const r = await quiet(() => s.scheduler.runSchedulerCycle());
  assert.equal(r.assigned, 0);
  assert.equal(r.skipped, 1);
  assert.equal(s.jobs[0].gpuId, "g2", "the other writer's assignment is not overwritten");
  assert.equal(s.gpus[0].status, GPU_STATUS.ACTIVE, "g1 released");
  assert.equal(s.gpus[0].availability, true);
  assert.deepEqual(busyWithoutJob(s.jobs, s.gpus), []);
});

test("injected database error during the job claim does not leave the GPU BUSY", async () => {
  const s = setup({ jobs: [job(JOB_A, 1)], gpus: [gpu("g1", 50)] });
  const realJobUpdate = s.Job.findOneAndUpdate;
  s.Job.findOneAndUpdate = async (filter, ...rest) => {
    if (filter.status === JOB_STATUS.QUEUED) throw new Error("injected: connection reset");
    return realJobUpdate(filter, ...rest);
  };
  const r = await quiet(() => s.scheduler.runSchedulerCycle());
  assert.equal(r.errors, 1);
  assert.equal(r.assigned, 0);
  assert.equal(s.jobs[0].status, JOB_STATUS.QUEUED);
  assert.equal(s.gpus[0].status, GPU_STATUS.ACTIVE);
  assert.equal(s.gpus[0].availability, true);
});

test("an error in one job does not stop the cycle for later jobs", async () => {
  const s = setup({ jobs: [job(JOB_A, 1), job(JOB_B, 2)], gpus: [gpu("g1", 50), gpu("g2", 80)] });
  const realJobUpdate = s.Job.findOneAndUpdate;
  s.Job.findOneAndUpdate = async (filter, ...rest) => {
    if (String(filter._id) === JOB_A && filter.status === JOB_STATUS.QUEUED) throw new Error("injected");
    return realJobUpdate(filter, ...rest);
  };
  const r = await quiet(() => s.scheduler.runSchedulerCycle());
  assert.equal(r.errors, 1);
  assert.equal(r.assigned, 1);
  assert.equal(s.jobs[1].status, JOB_STATUS.ASSIGNED);
  assert.deepEqual(busyWithoutJob(s.jobs, s.gpus), []);
});

test("FIFO: with one GPU, the oldest queued job is assigned first", async () => {
  const s = setup({ jobs: [job(JOB_B, 2), job(JOB_A, 1)], gpus: [gpu("g1", 50)] });
  // The in-memory find() does not sort; queue.js sorts by createdAt. Present
  // the store already in FIFO order to mirror the database result.
  s.jobs.sort((a, b) => a.createdAt - b.createdAt);
  await quiet(() => s.scheduler.runSchedulerCycle());
  assert.equal(s.jobs.find((j) => j._id === JOB_A).status, JOB_STATUS.ASSIGNED);
  assert.equal(s.jobs.find((j) => j._id === JOB_B).status, JOB_STATUS.QUEUED);
});

function failingChain() {
  return {
    isAvailable: () => true,
    toBlockchainJobId: (id) => "0x" + String(id).padStart(64, "0"),
    assignJob: async () => { throw new Error("execution reverted: JobDoesNotExist()"); },
  };
}

test("blockchain assignJob failure rolls the job back to QUEUED and releases the GPU", async () => {
  const s = setup({
    jobs: [job(JOB_A, 1)], gpus: [gpu("g1", 50)],
    users: [{ _id: "p_g1", walletAddress: "0x90F79bf6EB2c4f870365E785982E1f101E93b906" }],
    blockchain: failingChain(),
  });
  const r = await quiet(() => s.scheduler.runSchedulerCycle());
  assert.equal(r.blockchainFailed, 1);
  assert.equal(s.jobs[0].status, JOB_STATUS.QUEUED);
  assert.equal(s.jobs[0].gpuId, null);
  assert.equal(s.gpus[0].status, GPU_STATUS.ACTIVE);
});

test("blockchain failure after a worker already started the job: no rollback, GPU stays with the job", async () => {
  const bc = failingChain();
  const s = setup({
    jobs: [job(JOB_A, 1)], gpus: [gpu("g1", 50)],
    users: [{ _id: "p_g1", walletAddress: "0x90F79bf6EB2c4f870365E785982E1f101E93b906" }],
    blockchain: bc,
  });
  bc.assignJob = async () => {
    s.jobs[0].status = JOB_STATUS.RUNNING;          // worker picked the job up meanwhile
    throw new Error("execution reverted");
  };
  await quiet(() => s.scheduler.runSchedulerCycle());
  assert.equal(s.jobs[0].status, JOB_STATUS.RUNNING);
  assert.equal(s.jobs[0].gpuId, "g1");
  assert.equal(s.gpus[0].status, GPU_STATUS.BUSY);
});
