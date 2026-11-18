"use strict";
// Provider key remains on the worker. Only a public address/receipt is printed.
const { ethers } = require("ethers");
const ABI = [
  "function submitResult(bytes32 jobId,bytes32 resultHash)",
  "function getJob(bytes32) view returns (tuple(bytes32 jobId,address consumer,address provider,uint256 payment,bytes32 resultHash,uint8 status,bool paymentReleased))",
];
async function main() {
  const wallet = new ethers.Wallet(process.env.PROVIDER_PRIVATE_KEY);
  if (process.argv[2] === "address") { console.log(JSON.stringify({ address: wallet.address })); return; }
  const [contractAddress, jobId, resultHash, expectedInstance] = process.argv.slice(2);
  if (!ethers.isAddress(contractAddress) || !/^0x[0-9a-f]{64}$/.test(jobId) || !/^0x[0-9a-f]{64}$/.test(resultHash)) throw new Error("Invalid signing parameters");
  const provider = new ethers.JsonRpcProvider(process.env.BLOCKCHAIN_RPC_URL);
  try {
    const metadata = await provider.send("hardhat_metadata", []);
    if (Number(metadata.chainId) !== 31337 || `${metadata.instanceId}:${contractAddress.toLowerCase()}` !== expectedInstance) throw new Error("Local chain instance mismatch");
    const signer = wallet.connect(provider);
    const contract = new ethers.Contract(contractAddress, ABI, signer);
    const state = await contract.getJob(jobId);
    if (state.provider.toLowerCase() !== wallet.address.toLowerCase()) throw new Error("Not the assigned provider");
    if (Number(state.status) >= 4 && Number(state.status) <= 6 && state.resultHash === resultHash) {
      console.log(JSON.stringify({ alreadySubmitted: true })); return;
    }
    if (Number(state.status) !== 3) throw new Error("Job is not awaiting provider submission");
    const nonce = Number(BigInt(await provider.send("eth_getTransactionCount", [wallet.address, "pending"])));
    const tx = await contract.submitResult(jobId, resultHash, { nonce });
    const receipt = await tx.wait(1, 30000);
    if (receipt.status !== 1) throw new Error("Provider transaction failed");
    console.log(JSON.stringify({ txHash: tx.hash, gasUsed: receipt.gasUsed.toString() }));
  } finally { provider.destroy(); }
}
main().catch((error) => { console.error(error.shortMessage || error.message); process.exitCode = 1; });
