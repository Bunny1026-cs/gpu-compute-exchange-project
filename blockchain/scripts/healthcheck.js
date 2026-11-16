/**
 * scripts/healthcheck.js
 * Docker health check for the local Hardhat node (P1-11).
 *
 * Healthy (exit 0) only when the JSON-RPC endpoint answers AND contract
 * bytecode exists at ESCROW_CONTRACT_ADDRESS, i.e. after
 * scripts/start-local-node.sh has finished deploying. The backend waits for
 * this (docker-compose: condition: service_healthy) so its one-time
 * blockchain initialisation does not run before the contract exists.
 *
 * Uses only Node's built-in fetch (Node >= 18). No dependencies.
 */

const RPC_URL = process.env.HEALTHCHECK_RPC_URL || "http://127.0.0.1:8545";
const ADDRESS = process.env.ESCROW_CONTRACT_ADDRESS || "0x5FbDB2315678afecb367f032d93F642f64180aa3";

async function main() {
  const res = await fetch(RPC_URL, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_getCode", params: [ADDRESS, "latest"] }),
    signal: AbortSignal.timeout(4000),
  });
  if (!res.ok) throw new Error(`RPC HTTP ${res.status}`);
  const { result, error } = await res.json();
  if (error) throw new Error(error.message || "RPC error");
  if (!result || result === "0x") throw new Error(`no contract code at ${ADDRESS} yet`);
  console.log(`healthy: contract code present at ${ADDRESS}`);
}

main().then(() => process.exit(0)).catch((err) => {
  console.error(`unhealthy: ${err.message}`);
  process.exit(1);
});
