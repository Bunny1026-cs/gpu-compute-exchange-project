require("@nomicfoundation/hardhat-toolbox");

/** @type import('hardhat/config').HardhatUserConfig */
module.exports = {
  solidity: {
    version: "0.8.24",
    settings: {
      optimizer: {
        enabled: true,
        runs: 200,
      },
    },
  },
  networks: {
    // Local Hardhat development node
    localhost: {
      url: "http://127.0.0.1:8545",
    },
    // Testnets — add private keys via environment variables (Phase 3)
    // sepolia: {
    //   url: process.env.SEPOLIA_RPC_URL || "",
    //   accounts: process.env.DEPLOYER_PRIVATE_KEY ? [process.env.DEPLOYER_PRIVATE_KEY] : [],
    // },
  },
  // Gas reporter (uncomment in Phase 3)
  // gasReporter: {
  //   enabled: true,
  //   currency: "USD",
  // },
};
