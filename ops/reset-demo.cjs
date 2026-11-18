"use strict";
// Reset only the dedicated demo database. Stop backend/worker first. Existing
// chain escrows must be refunded before reset; resetting a DB cannot refund ETH.
const mongoose = require("../backend/node_modules/mongoose");
const fs = require("fs");
const path = require("path");
async function main() {
  const config = require("../backend/node_modules/dotenv").parse(fs.readFileSync(path.resolve(__dirname, "../runtime/backend.env")));
  const uri = config.MONGODB_URI;
  if (uri !== "mongodb://127.0.0.1:27017/bdgce_real_demo") throw new Error("Reset restricted to the dedicated local bdgce_real_demo database");
  if (process.argv[2] !== "--chain-restarted") throw new Error("Stop backend/worker and restart Hardhat first; then pass --chain-restarted. This resets local test data only.");
  await mongoose.connect(uri);
  try {
    const rpc = new (require("../backend/node_modules/ethers").JsonRpcProvider)("http://127.0.0.1:8545");
    try {
      const metadata = await rpc.send("hardhat_metadata", []);
      if (Number(metadata.chainId) !== 31337 || !/^0x[0-9a-f]+$/i.test(metadata.instanceId)) {
        throw new Error("A local Hardhat instance is required for reset");
      }
      const prefix = new RegExp("^" + metadata.instanceId + ":", "i");
      const deployment = path.resolve(__dirname, "../runtime/chain.json");
      if (fs.existsSync(deployment) && JSON.parse(fs.readFileSync(deployment)).instanceId === metadata.instanceId) {
        throw new Error("The configured deployment still exists on this Hardhat instance. Restart the local chain first.");
      }
      const db = mongoose.connection.db;
      if (await db.collection("jobs").findOne({ chainInstance: prefix }) ||
          await db.collection("chainjournals").findOne({ instance: prefix })) {
        throw new Error("The running chain still owns demo records. Stop and restart Hardhat first.");
      }
    } finally { rpc.destroy(); }
    const root = path.resolve(__dirname, "..");
    for (const relative of ["backend/results", "worker/results"]) {
      const target = path.resolve(root, relative);
      if (!target.startsWith(root + path.sep)) throw new Error("Unsafe artifact path");
      // Preserve artifacts as a timestamped backup instead of deleting them.
      if (fs.existsSync(target)) fs.renameSync(target, target + ".reset-" + Date.now());
    }
    await mongoose.connection.dropDatabase();
    console.log("Dedicated demo database reset; artifacts retained in timestamped folders. Redeploy, configure, and provision before restart.");
  } finally { await mongoose.disconnect(); }
}
main().catch((error) => { console.error(error.message); process.exitCode = 1; });
