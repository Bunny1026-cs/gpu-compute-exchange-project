/**
 * blockchain/blockchainService.js
 * GPU Compute Exchange — Blockchain Service (Phase 7)
 *
 * ═══════════════════════════════════════════════════════════════
 * PURPOSE
 * ═══════════════════════════════════════════════════════════════
 * Single service layer between the Node.js backend and the
 * GPUComputeEscrow Solidity contract. All ethers.js logic lives
 * here — controllers and the scheduler only call this service.
 *
 * ═══════════════════════════════════════════════════════════════
 * CURRENCY / DEMO WARNING
 * ═══════════════════════════════════════════════════════════════
 * This service connects ONLY to a local Hardhat network.
 * ALL ETH used is test/demo ETH with ZERO real-world value.
 * The app price (₹/hour) is SEPARATE from blockchain amounts (wei).
 * No exchange rate is applied. Do NOT use on mainnet.
 *
 * ═══════════════════════════════════════════════════════════════
 * STATE MACHINE RELATIONSHIP
 * ═══════════════════════════════════════════════════════════════
 * MongoDB (application)        Blockchain (escrow/trust)
 * ─────────────────────        ────────────────────────────────
 * CREATED                      (not yet registered)
 * QUEUED                       REGISTERED → FUNDED  (demo flow)
 * ASSIGNED                     ASSIGNED
 * RUNNING                      RESULT_SUBMITTED
 * RESULT_UPLOADED              (verified off-chain)
 * COMPLETED                    VERIFIED → COMPLETED
 * FAILED/CANCELLED             REFUNDED
 *
 * ═══════════════════════════════════════════════════════════════
 * DEMO ACCOUNTS (LOCAL HARDHAT ONLY)
 * ═══════════════════════════════════════════════════════════════
 * These are Hardhat's well-known public test accounts. They have
 * NO real-world value. Private keys are in .env (gitignored).
 * Account[1] = operator  (BLOCKCHAIN_PRIVATE_KEY)
 * Account[2] = demo consumer (DEMO_CONSUMER_PRIVATE_KEY)
 *
 * ═══════════════════════════════════════════════════════════════
 * NONCE MANAGEMENT
 * ═══════════════════════════════════════════════════════════════
 * ethers v6 caches nonces internally per Wallet instance. When
 * multiple sequential transactions are sent (e.g. registerJob
 * followed by depositFunds), the cached nonce can become stale
 * after the first tx mines.
 *
 * Solution: Each transaction method creates a fresh Wallet from
 * the private key AND explicitly fetches the current nonce from
 * the chain using provider.getTransactionCount(addr, "latest")
 * BEFORE constructing the transaction. The nonce is passed as an
 * explicit override to bypass ethers' internal nonce management.
 *
 * ═══════════════════════════════════════════════════════════════
 * GRACEFUL DEGRADATION
 * ═══════════════════════════════════════════════════════════════
 * If blockchain env vars are not set:
 *   → this.available = false
 *   → all write methods throw BlockchainUnavailableError
 *   → scheduler falls back to MongoDB-only mode (no crash)
 */

"use strict";

const { ethers }                       = require("ethers");
const { ESCROW_ABI, BLOCKCHAIN_JOB_STATUS } = require("./contractAbi");

// ── Custom error ────────────────────────────────────────────────
class BlockchainUnavailableError extends Error {
  constructor(msg = "Blockchain service not available") {
    super(msg);
    this.name = "BlockchainUnavailableError";
  }
}

// ═══════════════════════════════════════════════════════════════
// BlockchainService
// ═══════════════════════════════════════════════════════════════
class BlockchainService {
  constructor() {
    /** @type {ethers.JsonRpcProvider|null} */
    this.provider = null;
    /** @type {ethers.Wallet|null} Operator wallet (for reads/verification only) */
    this.operatorWallet = null;
    /** @type {ethers.Wallet|null} Demo-consumer wallet (for reads/verification only) */
    this.demoConsumerWallet = null;
    /** @type {ethers.Contract|null} Contract instance (read-only) */
    this.contract = null;
    /** @type {ethers.Contract|null} Read-only contract instance */
    this.readContract = null;
    /** @type {string|null} Contract address */
    this.contractAddress = null;

    this.initialized = false;
    this.available   = false;
  }

  // ────────────────────────────────────────────────────────────
  // PRIVATE HELPERS
  // ────────────────────────────────────────────────────────────

  /**
   * _makeFreshSigner(privateKey)
   * Creates a fresh Wallet + Contract pair for a single transaction.
   * Each call gets its own Wallet so ethers' internal nonce cache
   * cannot become stale between sequential transactions.
   *
   * @param {string} privateKey
   * @returns {{ wallet: ethers.Wallet, contract: ethers.Contract }}
   */
  _makeFreshSigner(privateKey) {
    const wallet = new ethers.Wallet(privateKey, this.provider);
    const contract = new ethers.Contract(this.contractAddress, ESCROW_ABI, wallet);
    return { wallet, contract };
  }

  /**
   * _getNonce(address)
   * Fetches the CURRENT confirmed nonce from the chain.
   * Uses "latest" block tag so the nonce reflects all mined transactions.
   */
  async _getNonce(address) {
    return await this.provider.getTransactionCount(address, "latest");
  }

  // ────────────────────────────────────────────────────────────
  // INITIALIZATION
  // ────────────────────────────────────────────────────────────

  async initialize() {
    const rpcUrl         = process.env.BLOCKCHAIN_RPC_URL;
    const privateKey     = process.env.BLOCKCHAIN_PRIVATE_KEY;
    const contractAddr   = process.env.ESCROW_CONTRACT_ADDRESS;
    const demoConsumerKey = process.env.DEMO_CONSUMER_PRIVATE_KEY;
    const demoMode       = process.env.BLOCKCHAIN_DEMO_MODE === "true";

    if (!rpcUrl || !privateKey || !contractAddr) {
      console.log("[Blockchain] ⚠️  Blockchain env vars not set. Running in MongoDB-only mode.");
      this.available   = false;
      this.initialized = true;
      return;
    }

    try {
      this.provider = new ethers.JsonRpcProvider(rpcUrl);
      const network = await this.provider.getNetwork();
      console.log(`[Blockchain] ✅ Connected to network: ${network.name} (chainId: ${network.chainId})`);

      // Store addresses for reference (never log private keys)
      this.operatorWallet = new ethers.Wallet(privateKey, this.provider);
      console.log(`[Blockchain] ✅ Operator wallet: ${this.operatorWallet.address}`);

      if (demoMode && demoConsumerKey) {
        this.demoConsumerWallet = new ethers.Wallet(demoConsumerKey, this.provider);
        console.log(`[Blockchain] ✅ Demo consumer wallet: ${this.demoConsumerWallet.address} (DEMO ONLY — no real value)`);
      }

      // Verify contract bytecode
      const code = await this.provider.getCode(contractAddr);
      if (!code || code === "0x") {
        throw new Error(`No contract found at ${contractAddr}. Deploy the contract first.`);
      }
      console.log(`[Blockchain] ✅ Contract bytecode verified at ${contractAddr}`);

      this.contractAddress = contractAddr;
      this.contract     = new ethers.Contract(contractAddr, ESCROW_ABI, this.operatorWallet);
      this.readContract = new ethers.Contract(contractAddr, ESCROW_ABI, this.provider);

      // Verify operator
      const onChainOperator = await this.readContract.operator();
      if (onChainOperator.toLowerCase() !== this.operatorWallet.address.toLowerCase()) {
        console.warn(`[Blockchain] ⚠️  Operator mismatch! Backend: ${this.operatorWallet.address}, Contract: ${onChainOperator}`);
      } else {
        console.log(`[Blockchain] ✅ Operator address matches contract`);
      }

      this._setupEventListeners();
      this.available   = true;
      this.initialized = true;
      console.log("[Blockchain] ✅ BlockchainService ready.");
    } catch (err) {
      console.error("[Blockchain] ❌ Initialization failed:", err.message);
      this.available   = false;
      this.initialized = true;
    }
  }

  isAvailable() { return this.available; }

  _requireAvailable() {
    if (!this.available) {
      throw new BlockchainUnavailableError(
        "Blockchain service not available. Check env vars."
      );
    }
  }

  // ────────────────────────────────────────────────────────────
  // JOB ID MAPPING
  // ────────────────────────────────────────────────────────────

  /**
   * toBlockchainJobId(mongoJobId)
   * Maps a 24-char hex MongoDB ObjectId to a Solidity bytes32.
   * Zero-pads left to 32 bytes.
   */
  toBlockchainJobId(mongoJobId) {
    const hex = mongoJobId.toString().toLowerCase().replace(/^0x/, "");
    if (!/^[0-9a-f]{24}$/.test(hex)) {
      throw new Error(`Invalid MongoDB ObjectId: "${hex}". Expected 24 hex characters.`);
    }
    return "0x" + hex.padStart(64, "0");
  }

  /**
   * fromBlockchainJobId(bytes32hex)
   * Reverse: strip leading zeros to recover 24-char ObjectId.
   */
  fromBlockchainJobId(bytes32hex) {
    const hex = bytes32hex.replace(/^0x0*/, "").toLowerCase();
    if (hex.length > 24) {
      throw new Error(`bytes32 too large for ObjectId: ${bytes32hex}`);
    }
    return hex.padStart(24, "0");
  }

  // ────────────────────────────────────────────────────────────
  // READ OPERATIONS (no signing needed)
  // ────────────────────────────────────────────────────────────

  async getJob(blockchainJobId) {
    this._requireAvailable();
    const job = await this.readContract.getJob(blockchainJobId);
    return {
      jobId:           job.jobId,
      consumer:        job.consumer,
      provider:        job.provider,
      payment:         job.payment.toString(),
      resultHash:      job.resultHash,
      status:          Number(job.status),
      statusLabel:     BLOCKCHAIN_JOB_STATUS[Number(job.status)] ?? "UNKNOWN",
      paymentReleased: job.paymentReleased,
    };
  }

  async getEscrowBalance() {
    this._requireAvailable();
    const balanceWei = await this.readContract.getEscrowBalance();
    return {
      wei:   balanceWei.toString(),
      ether: ethers.formatEther(balanceWei),
    };
  }

  // ────────────────────────────────────────────────────────────
  // DEMO CONSUMER OPERATIONS (LOCAL DEMO ONLY — no real money)
  // ────────────────────────────────────────────────────────────

  /**
   * demoRegisterJob(blockchainJobId)
   * ⚠️  DEVELOPMENT/DEMO ONLY — uses the demo consumer wallet.
   */
  async demoRegisterJob(blockchainJobId) {
    this._requireAvailable();
    this._requireDemoMode();

    const { wallet, contract } = this._makeFreshSigner(process.env.DEMO_CONSUMER_PRIVATE_KEY);
    const nonce = await this._getNonce(wallet.address);
    console.log(`[Blockchain] 📊 registerJob nonce for ${wallet.address}: ${nonce}`);

    const tx = await contract.registerJob(blockchainJobId, { nonce });
    const receipt = await tx.wait(1);
    console.log(`[Blockchain] 📋 Demo: Job ${blockchainJobId} registered. tx: ${receipt.hash}`);
    return { txHash: receipt.hash, blockNumber: receipt.blockNumber };
  }

  /**
   * demoDepositFunds(blockchainJobId, amountWei)
   * ⚠️  DEVELOPMENT/DEMO ONLY — deposits test ETH (ZERO real value).
   */
  async demoDepositFunds(blockchainJobId, amountWei) {
    this._requireAvailable();
    this._requireDemoMode();

    const { wallet, contract } = this._makeFreshSigner(process.env.DEMO_CONSUMER_PRIVATE_KEY);
    const nonce = await this._getNonce(wallet.address);
    console.log(`[Blockchain] 📊 depositFunds nonce for ${wallet.address}: ${nonce}`);

    const tx = await contract.depositFunds(blockchainJobId, {
      value: BigInt(amountWei),
      nonce,
    });
    const receipt = await tx.wait(1);
    console.log(`[Blockchain] 💰 Demo: Deposited ${amountWei} wei for job ${blockchainJobId}. tx: ${receipt.hash}`);
    return { txHash: receipt.hash, blockNumber: receipt.blockNumber };
  }

  _requireDemoMode() {
    if (!this.demoConsumerWallet) {
      throw new BlockchainUnavailableError("Demo consumer wallet not configured.");
    }
    if (process.env.BLOCKCHAIN_DEMO_MODE !== "true") {
      throw new Error("Demo operations only allowed when BLOCKCHAIN_DEMO_MODE=true");
    }
  }

  // ────────────────────────────────────────────────────────────
  // OPERATOR TRANSACTIONS (signed by operator wallet)
  // ────────────────────────────────────────────────────────────

  async assignJob(blockchainJobId, providerAddress) {
    this._requireAvailable();
    if (!ethers.isAddress(providerAddress)) {
      throw new Error(`Invalid provider Ethereum address: "${providerAddress}"`);
    }

    const { wallet, contract } = this._makeFreshSigner(process.env.BLOCKCHAIN_PRIVATE_KEY);
    const nonce = await this._getNonce(wallet.address);
    const tx = await contract.assignJob(blockchainJobId, providerAddress, { nonce });
    const receipt = await tx.wait(1);
    console.log(`[Blockchain] ✅ assignJob confirmed. tx: ${receipt.hash}`);
    return {
      txHash:      receipt.hash,
      blockNumber: receipt.blockNumber,
      blockchainJobId,
      providerAddress,
    };
  }

  async verifyResult(blockchainJobId, resultHash) {
    this._requireAvailable();
    const { wallet, contract } = this._makeFreshSigner(process.env.BLOCKCHAIN_PRIVATE_KEY);
    const nonce = await this._getNonce(wallet.address);
    const tx = await contract.verifyResult(blockchainJobId, resultHash, { nonce });
    const receipt = await tx.wait(1);
    console.log(`[Blockchain] ✅ verifyResult confirmed. tx: ${receipt.hash}`);
    return { txHash: receipt.hash, blockNumber: receipt.blockNumber };
  }

  async releasePayment(blockchainJobId) {
    this._requireAvailable();
    const { wallet, contract } = this._makeFreshSigner(process.env.BLOCKCHAIN_PRIVATE_KEY);
    const nonce = await this._getNonce(wallet.address);
    const tx = await contract.releasePayment(blockchainJobId, { nonce });
    const receipt = await tx.wait(1);
    console.log(`[Blockchain] ✅ releasePayment confirmed. tx: ${receipt.hash}`);
    return { txHash: receipt.hash, blockNumber: receipt.blockNumber };
  }

  async refund(blockchainJobId) {
    this._requireAvailable();
    const { wallet, contract } = this._makeFreshSigner(process.env.BLOCKCHAIN_PRIVATE_KEY);
    const nonce = await this._getNonce(wallet.address);
    const tx = await contract.refund(blockchainJobId, { nonce });
    const receipt = await tx.wait(1);
    console.log(`[Blockchain] ✅ refund confirmed. tx: ${receipt.hash}`);
    return { txHash: receipt.hash, blockNumber: receipt.blockNumber };
  }

  // ────────────────────────────────────────────────────────────
  // EVENT LISTENERS
  // ────────────────────────────────────────────────────────────

  _setupEventListeners() {
    if (!this.readContract) return;

    this.readContract.on("JobRegistered",  (jobId, consumer) =>
      console.log(`[Blockchain Event] JobRegistered  jobId=${jobId} consumer=${consumer}`)
    );
    this.readContract.on("FundsDeposited", (jobId, consumer, amount) =>
      console.log(`[Blockchain Event] FundsDeposited jobId=${jobId} consumer=${consumer} amount=${amount}wei`)
    );
    this.readContract.on("JobAssigned",    (jobId, provider) =>
      console.log(`[Blockchain Event] JobAssigned    jobId=${jobId} provider=${provider}`)
    );
    this.readContract.on("ResultSubmitted",(jobId, provider, resultHash) =>
      console.log(`[Blockchain Event] ResultSubmitted jobId=${jobId} provider=${provider}`)
    );
    this.readContract.on("ResultVerified", (jobId, resultHash) =>
      console.log(`[Blockchain Event] ResultVerified  jobId=${jobId}`)
    );
    this.readContract.on("PaymentReleased",(jobId, provider, amount) =>
      console.log(`[Blockchain Event] PaymentReleased jobId=${jobId} provider=${provider} amount=${amount}wei`)
    );
    this.readContract.on("RefundIssued",   (jobId, consumer, amount) =>
      console.log(`[Blockchain Event] RefundIssued    jobId=${jobId} consumer=${consumer} amount=${amount}wei`)
    );

    console.log("[Blockchain] 👂 Event listeners attached for all contract events.");
  }

  async destroy() {
    if (this.readContract) await this.readContract.removeAllListeners();
    if (this.provider) this.provider.destroy();
  }
}

// ── Singleton export ──────────────────────────────────────────
const blockchainService = new BlockchainService();

module.exports = blockchainService;
module.exports.BlockchainUnavailableError = BlockchainUnavailableError;
