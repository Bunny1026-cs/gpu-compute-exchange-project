"use strict";
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");
const { Wallet } = require("../worker/node_modules/ethers");
const root = path.resolve(__dirname, "..");
const config = require("../backend/node_modules/dotenv").parse(fs.readFileSync(path.join(root, "runtime/worker.env")));
const run = (key) => spawnSync(process.execPath, [path.join(root, "worker/provider_signer.cjs"), "preflight"], {
  env: { ...process.env, ...config, PROVIDER_PRIVATE_KEY: key }, encoding: "utf8", timeout: 30000,
});
const funded = run(config.PROVIDER_PRIVATE_KEY);
assert.equal(funded.status, 0, funded.stderr);
const publicInfo = JSON.parse(funded.stdout);
assert.ok(BigInt(publicInfo.balanceWei) >= BigInt(publicInfo.gasBudgetWei));
const unfunded = run(Wallet.createRandom().privateKey);
assert.equal(unfunded.status, 1);
assert.match(unfunded.stderr, /needs local test ETH/);
const output = path.join(root, "evidence/milestone2");
fs.mkdirSync(output, { recursive: true });
fs.writeFileSync(path.join(output, "wallet-preflight.json"), JSON.stringify({ recordedAt: new Date().toISOString(),
  fundedWalletAccepted: true, unfundedWalletRejected: true, publicInfo }, null, 2));
console.log("PASS: funded provider accepted; unfunded wallet rejected before worker startup");
