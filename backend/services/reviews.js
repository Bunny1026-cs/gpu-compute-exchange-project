const compute = require("./realCompute");
const Job = require("../models/Job");
async function decide(id, decision, reason, operator = false) {
  if (!["accept","issue","refund"].includes(decision) || (!operator && decision === "refund")) throw compute.fail("Invalid decision");
  await compute.locked(id, async job => {
    if (job.taskType !== "python_batch") throw compute.fail("Script job required");
    if (decision === job.decision && (decision !== "issue" || job.status === "DISPUTED")) return;
    if (operator ? !(job.status === "DISPUTED" || (job.status === "REVIEW" && job.reviewUntil <= new Date())) :
        job.status !== "REVIEW" || job.reviewUntil <= new Date()) throw compute.fail("Review is closed or unavailable", 409);
    if (decision !== "accept" && !String(reason || "").trim()) throw compute.fail("Give a reason");
    const status = { accept: "SETTLEMENT_PENDING", issue: "DISPUTED", refund: "REFUND_PENDING" }[decision];
    const note = String(reason || "").slice(0, 1000);
    await Job.updateOne({ _id: id, status: job.status }, { $set: { status, decision, error: note },
      $push: { reviewHistory: { decision, reason: note, actor: operator ? "operator" : "consumer", at: new Date() } } });
  });
  // The running backend owns the operator nonce sequence for all jobs.
  if (operator) return Job.findById(id);
  if (decision === "accept") return compute.settle(id);
  if (decision === "refund") return compute.refund(id, reason);
  return Job.findById(id);
}
module.exports = { decide };
