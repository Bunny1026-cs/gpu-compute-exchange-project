/**
 * scripts/check-local-chain.js
 * Integration check of the backend's blockchainService against a RUNNING
 * local Hardhat node with GPUComputeEscrow deployed (blockchain/:
 * `npm run start:local`, or the hardhat-node Compose service).
 *
 * Not part of `npm test` (needs a chain). Uses the well-known Hardhat test
 * accounts (#1 operator, #2 demo consumer, #3 provider), which hold only
 * worthless local test ETH. Job IDs are random, so the check can be re-run
 * on the same chain.
 *
 * Checks:
 *   1. P1-7  a wrong operator key leaves the service unavailable
 *   2.       the correct operator key makes it available
 *   3. P1-8  sequential demo register + deposit pairs succeed
 *   4. P1-8  concurrent operator transactions all succeed
 *   5. P1-6  assigning the operator or the consumer as provider reverts
 *            with InvalidProvider; a distinct provider is accepted
 *
 * Usage:  npm run check:chain      (exit code 0 = all checks passed)
 */

"use strict";

const path = require("path");
const crypto = require("crypto");
const { ethers } = require("ethers");

const RPC = process.env.BLOCKCHAIN_RPC_URL || "http://127.0.0.1:8545";
const ADDRESS = process.env.ESCROW_CONTRACT_ADDRESS || "0x5FbDB2315678afecb367f032d93F642f64180aa3";
const KEYS = {   // Hardhat default accounts — local test chain only
  operator: "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d", // #1
  consumer: "0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a", // #2
  provider: "0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6", // #3
};
const SERVICE = path.join(__dirname, "../blockchain/blockchainService.js");

function loadService(operatorKey) {
  for (const k of Object.keys(require.cache)) if (k.includes(`${path.sep}blockchain${path.sep}`) && !k.includes("node_modules")) delete require.cache[k];
  Object.assign(process.env, { BLOCKCHAIN_RPC_URL: RPC, ESCROW_CONTRACT_ADDRESS: ADDRESS, BLOCKCHAIN_PRIVATE_KEY: operatorKey,
    DEMO_CONSUMER_PRIVATE_KEY: KEYS.consumer, BLOCKCHAIN_DEMO_MODE: "true" });
  return require(SERVICE);
}
const randomJobId = (bc) => bc.toBlockchainJobId(crypto.randomBytes(12).toString("hex"));
const decode = (e, iface) => { try { return iface.parseError(e.data)?.name || e.shortMessage; } catch (_) { return e.shortMessage || e.message; } };

async function main() {
  const results = [];
  const check = (name, ok, detail) => results.push({ name, ok, detail });
  const out = console.log;
  console.log = console.warn = console.error = () => {};
  try {
    let bc = loadService(KEYS.provider);                     // wrong operator key
    await bc.initialize();
    check("1 wrong operator key -> unavailable", !bc.isAvailable(), `available=${bc.isAvailable()}`);
    await bc.destroy();

    bc = loadService(KEYS.operator);
    await bc.initialize();
    check("2 correct operator key -> available", bc.isAvailable(), `available=${bc.isAvailable()}`);
    if (!bc.isAvailable()) throw new Error("service unavailable; is the node running with the contract deployed?");

    let ok = 0;
    for (let i = 0; i < 5; i++) { const id = randomJobId(bc); await bc.demoRegisterJob(id); await bc.demoDepositFunds(id, "1000"); ok++; }
    check("3 sequential register+deposit", ok === 5, `${ok}/5`);

    const ids = [];
    for (let i = 0; i < 5; i++) { const id = randomJobId(bc); await bc.demoRegisterJob(id); await bc.demoDepositFunds(id, "1000"); ids.push(id); }
    const providerAddr = new ethers.Wallet(KEYS.provider).address;
    const settled = await Promise.allSettled(ids.map((id) => bc.assignJob(id, providerAddr)));
    const fulfilled = settled.filter((r) => r.status === "fulfilled").length;
    check("4 concurrent operator transactions", fulfilled === 5, `${fulfilled}/5`);

    const { ESCROW_ABI } = require("../blockchain/contractAbi");
    const iface = new ethers.Interface(ESCROW_ABI);
    const id = randomJobId(bc);
    await bc.demoRegisterJob(id); await bc.demoDepositFunds(id, "1000");
    const attempt = async (addr) => { try { await bc.assignJob(id, addr); return "accepted"; } catch (e) { return decode(e, iface); } };
    const asOperator = await attempt(bc.operatorWallet.address);
    const asConsumer = await attempt(bc.demoConsumerWallet.address);
    const asProvider = await attempt(providerAddr);
    check("5 role separation", asOperator === "InvalidProvider" && asConsumer === "InvalidProvider" && asProvider === "accepted",
      `operator:${asOperator}, consumer:${asConsumer}, provider:${asProvider}`);
    await bc.destroy();
  } catch (e) {
    check("unexpected error", false, e.message);
  } finally {
    console.log = out;
  }
  for (const r of results) out(`${r.ok ? "PASS" : "FAIL"}  ${r.name}  (${r.detail})`);
  const failed = results.filter((r) => !r.ok).length;
  out(failed ? `\n${failed} check(s) FAILED` : `\nAll ${results.length} checks passed`);
  process.exit(failed ? 1 : 0);
}

main();
