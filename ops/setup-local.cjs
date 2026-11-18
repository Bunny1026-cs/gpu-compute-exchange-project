"use strict";
// Creates ignored configuration only. Never overwrites a component's personal .env.
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { ethers } = require("../backend/node_modules/ethers");
const root = path.resolve(__dirname, "..");
const runtime = path.join(root, "runtime");
fs.mkdirSync(runtime, { recursive: true });
const mode = process.argv[2] || "real_gpu";
if (!["real_gpu", "real_cpu_test"].includes(mode)) throw new Error("Expected real_gpu or real_cpu_test");
// Public Hardhat development mnemonic. These accounts must never hold real funds.
const phrase = "test test test test test test test test test test test junk";
const account = (index) => ethers.HDNodeWallet.fromPhrase(phrase, undefined, `m/44'/60'/0'/0/${index}`);
const accountsFile = path.join(runtime, "accounts.json");
if (!fs.existsSync(accountsFile)) fs.writeFileSync(accountsFile, JSON.stringify({
  consumer: { name: "Demo Consumer", email: "consumer@bdgce.local", password: crypto.randomBytes(18).toString("hex"), role: "CONSUMER" },
  provider: { name: "Demo Provider", email: "provider@bdgce.local", password: crypto.randomBytes(18).toString("hex"), role: "PROVIDER", walletAddress: account(3).address },
}, null, 2));
const jwtFile = path.join(runtime, "jwt-secret");
if (!fs.existsSync(jwtFile)) fs.writeFileSync(jwtFile, crypto.randomBytes(32).toString("hex"));
const chainFile = path.join(runtime, "chain.json");
const address = fs.existsSync(chainFile) ? JSON.parse(fs.readFileSync(chainFile)).address : "0x5FbDB2315678afecb367f032d93F642f64180aa3";
const backend = {
  NODE_ENV: "development", PORT: "5000", MONGODB_URI: "mongodb://127.0.0.1:27017/bdgce_real_demo",
  JWT_SECRET: fs.readFileSync(jwtFile, "utf8"), EXECUTION_MODE: mode, FINAL_DEMO: String(mode === "real_gpu"),
  BLOCKCHAIN_RPC_URL: "http://127.0.0.1:8545", BLOCKCHAIN_PRIVATE_KEY: account(1).privateKey,
  DEMO_CONSUMER_PRIVATE_KEY: account(2).privateKey, BLOCKCHAIN_DEMO_MODE: "true",
  ESCROW_CONTRACT_ADDRESS: address, RATE_WEI_PER_MINUTE: "1000000000000000", ENABLE_DEV_ROUTES: "false",
};
const workerFile = path.join(runtime, "worker.env");
const existing = fs.existsSync(workerFile) ? require("../backend/node_modules/dotenv").parse(fs.readFileSync(workerFile)) : {};
const worker = mode === "real_cpu_test" ? { BACKEND_URL: "http://127.0.0.1:5000/api", EXECUTION_MODE: mode, FINAL_DEMO: "false",
  BLOCKCHAIN_RPC_URL: "http://127.0.0.1:8545", PROVIDER_PRIVATE_KEY: account(3).privateKey,
  WORKER_API_KEY: existing.WORKER_API_KEY || "configure-through-provider-dashboard-or-provision-script" } : null;
const configs = [["backend.env", backend]];
if (worker) configs.push(["worker.env", worker]);
for (const [name, values] of configs) {
  fs.writeFileSync(path.join(runtime, name), Object.entries(values).map(([key, value]) => `${key}=${value}`).join("\n") + "\n");
}
console.log(`Prepared ignored runtime configuration (${mode}). Login credentials: runtime/accounts.json`);
console.log(`Wallets: operator ${account(1).address}; consumer ${account(2).address}; provider ${account(3).address}`);
