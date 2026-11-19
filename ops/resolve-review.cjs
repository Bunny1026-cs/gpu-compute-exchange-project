"use strict";
// Local operator command. Uses the same operator key and job lock as settlement.
const path = require("path");
require("../backend/node_modules/dotenv").config({path:process.env.BACKEND_ENV_FILE || path.join(__dirname,"../runtime/backend.env")});
const mongoose = require("../backend/node_modules/mongoose");
const { setTimeout: delay } = require("node:timers/promises");
const Job = require("../backend/models/Job");
const { decide } = require("../backend/services/reviews");
async function main() {
  await mongoose.connect(process.env.MONGODB_URI);
  try {
    const [id, choice, ...reason] = process.argv.slice(2);
    if (id === "list") {
      console.log(await Job.find({taskType:"python_batch",$or:[{status:"DISPUTED"},{status:"REVIEW",reviewUntil:{$lte:new Date()}}]}).select("status error reviewUntil").lean());
      return;
    }
    if (!["accept","refund"].includes(choice) || !reason.length) throw new Error("Use list, or JOB_ID accept|refund REASON");
    let job = await decide(id, choice, reason.join(" "), true);
    const terminal = choice === "refund" ? "REFUNDED" : "COMPLETED";
    for (let attempt = 0; job.status !== terminal && attempt < 30; attempt++) {
      await delay(1000);
      job = await Job.findById(id);
    }
    console.log(job.status);
    if (job.status !== terminal) throw new Error("Decision recorded. Check the running backend and escrow reconciliation.");
  } finally { await mongoose.disconnect(); }
}
main().catch(error=>{console.error(error.message);process.exitCode=1;});
