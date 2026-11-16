/**
 * scripts/deploy.js
 * Deploys GPUComputeEscrow to the selected Hardhat network.
 *
 * RECONSTRUCTED (P0-5): the original file was excluded from the repository by
 * a root .gitignore rule. This version implements only the behaviour that the
 * project documents:
 *   - deployer (owner)  = Hardhat account #0
 *   - operator          = Hardhat account #1   (backend/.env.example:
 *                         "Hardhat Account[1] — backend operator wallet";
 *                         docker-compose BLOCKCHAIN_PRIVATE_KEY default)
 *   - on an empty local chain the first deployment by account #0 lands at
 *     0x5FbDB2315678afecb367f032d93f642f64180aa3 (README, docker-compose
 *     ESCROW_CONTRACT_ADDRESS default)
 *
 * Usage:
 *   npx hardhat run scripts/deploy.js --network localhost
 */

const hre = require("hardhat");

async function main() {
  const [deployer, operator] = await hre.ethers.getSigners();
  if (!operator) {
    throw new Error("Expected at least two signers (deployer = #0, operator = #1).");
  }

  const Escrow = await hre.ethers.getContractFactory("GPUComputeEscrow");
  const escrow = await Escrow.connect(deployer).deploy(operator.address);
  await escrow.waitForDeployment();

  const address = await escrow.getAddress();
  console.log("GPUComputeEscrow deployed");
  console.log(`  network:  ${hre.network.name}`);
  console.log(`  address:  ${address}`);
  console.log(`  owner:    ${deployer.address} (account #0)`);
  console.log(`  operator: ${await escrow.operator()} (account #1)`);
  console.log("Set ESCROW_CONTRACT_ADDRESS in backend/.env to the address above.");
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
