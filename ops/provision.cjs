"use strict";
const fs = require("fs");
const path = require("path");
const runtime = path.resolve(__dirname, "../runtime");
const users = JSON.parse(fs.readFileSync(path.join(runtime, "accounts.json")));
const base = process.env.BACKEND_URL || "http://127.0.0.1:5000/api";
async function request(route, body, token, method = "POST") {
  const response = await fetch(base + route, { method, headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const data = await response.json();
  if (!response.ok) throw new Error(`${response.status}: ${data.message}`);
  return data;
}
async function main() {
  for (const user of Object.values(users)) {
    try { await request("/auth/register", user); }
    catch (error) { if (!error.message.startsWith("409:")) throw error; }
  }
  const login = await request("/auth/login", users.provider);
  const mode = (await request("/compute/config", null, login.token, "GET")).data.executionMode;
  const gpus = (await request("/gpus?mine=true", null, login.token, "GET")).data;
  const gpu = gpus[0] || (await request("/gpus", {}, login.token)).data;
  if (mode === "real_gpu") {
    console.log(`Demo accounts ready. Open provider slot ${gpu._id} on Laptop 2 to configure its wallet and worker credential.`);
    return;
  }
  if (mode !== "real_cpu_test") throw new Error("Unsupported execution mode");
  const credential = (await request(`/gpus/${gpu._id}/worker-key`, { walletAddress: users.provider.walletAddress }, login.token)).data;
  const file = path.join(runtime, "worker.env");
  fs.writeFileSync(file, fs.readFileSync(file, "utf8").replace(/^WORKER_API_KEY=.*$/m, `WORKER_API_KEY=${credential.workerApiKey}`));
  fs.writeFileSync(path.join(runtime, "provider.json"), JSON.stringify({ gpuId: gpu._id, walletAddress: credential.providerWallet }));
  console.log("Demo accounts ready; provider credential saved in ignored runtime/worker.env. No secrets printed.");
}
main().catch((error) => { console.error(error.message); process.exitCode = 1; });
