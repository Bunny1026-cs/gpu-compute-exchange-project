/**
 * test/GPUComputeEscrow.test.js
 * Comprehensive test suite — GPU Compute Exchange Escrow (Phase 6)
 *
 * 24 tests covering:
 *   - Deployment + access control
 *   - Job registration
 *   - Fund deposit / escrow
 *   - Provider assignment
 *   - Result submission
 *   - Result verification
 *   - Payment release
 *   - Refund
 *   - Invalid state transitions
 *
 * Run: npx hardhat test
 */

const { expect } = require("chai");
const { ethers } = require("hardhat");
const { loadFixture } = require("@nomicfoundation/hardhat-toolbox/network-helpers");

describe("GPUComputeEscrow", function () {

  // ── Fixture: fresh deployment for every test ────────────────
  async function deployFixture() {
    const [owner, operator, consumer, provider, outsider] = await ethers.getSigners();

    const Factory = await ethers.getContractFactory("GPUComputeEscrow");
    const contract = await Factory.deploy(operator.address);
    await contract.waitForDeployment();

    // A deterministic job ID (keccak256 of a MongoDB-style ObjectId)
    const jobId = ethers.keccak256(ethers.toUtf8Bytes("job_001"));
    const resultHash = ethers.keccak256(ethers.toUtf8Bytes("result_data_v1"));
    const depositAmount = ethers.parseEther("1.0");

    return { contract, owner, operator, consumer, provider, outsider, jobId, resultHash, depositAmount };
  }

  // Helper: advance a job to a specific status
  async function advanceToFunded(contract, consumer, operator, jobId, depositAmount) {
    await contract.connect(consumer).registerJob(jobId);
    await contract.connect(consumer).depositFunds(jobId, { value: depositAmount });
  }

  async function advanceToAssigned(contract, consumer, operator, provider, jobId, depositAmount) {
    await advanceToFunded(contract, consumer, operator, jobId, depositAmount);
    await contract.connect(operator).assignJob(jobId, provider.address);
  }

  async function advanceToResultSubmitted(contract, consumer, operator, provider, jobId, depositAmount, resultHash) {
    await advanceToAssigned(contract, consumer, operator, provider, jobId, depositAmount);
    await contract.connect(provider).submitResult(jobId, resultHash);
  }

  async function advanceToVerified(contract, consumer, operator, provider, jobId, depositAmount, resultHash) {
    await advanceToResultSubmitted(contract, consumer, operator, provider, jobId, depositAmount, resultHash);
    await contract.connect(operator).verifyResult(jobId, resultHash);
  }

  // ═════════════════════════════════════════════════════════════
  // 1. DEPLOYMENT
  // ═════════════════════════════════════════════════════════════

  describe("Deployment", function () {
    it("1. Should deploy with correct owner and operator", async function () {
      const { contract, owner, operator } = await loadFixture(deployFixture);

      expect(await contract.owner()).to.equal(owner.address);
      expect(await contract.operator()).to.equal(operator.address);
    });

    it("2. Should reject deployment with zero-address operator", async function () {
      const Factory = await ethers.getContractFactory("GPUComputeEscrow");
      await expect(Factory.deploy(ethers.ZeroAddress))
        .to.be.revertedWithCustomError({ interface: Factory.interface }, "InvalidAddress");
    });

    it("3. Owner can change operator", async function () {
      const { contract, owner, outsider } = await loadFixture(deployFixture);

      await expect(contract.connect(owner).setOperator(outsider.address))
        .to.emit(contract, "OperatorChanged");

      expect(await contract.operator()).to.equal(outsider.address);
    });

    it("4. Non-owner cannot change operator", async function () {
      const { contract, consumer, outsider } = await loadFixture(deployFixture);

      await expect(contract.connect(consumer).setOperator(outsider.address))
        .to.be.revertedWithCustomError(contract, "Unauthorized");
    });
  });

  // ═════════════════════════════════════════════════════════════
  // 2. JOB REGISTRATION
  // ═════════════════════════════════════════════════════════════

  describe("Register Job", function () {
    it("5. Consumer can register a job", async function () {
      const { contract, consumer, jobId } = await loadFixture(deployFixture);

      await expect(contract.connect(consumer).registerJob(jobId))
        .to.emit(contract, "JobRegistered")
        .withArgs(jobId, consumer.address);

      const job = await contract.getJob(jobId);
      expect(job.consumer).to.equal(consumer.address);
      expect(job.status).to.equal(1); // REGISTERED
    });

    it("6. Duplicate job registration rejected", async function () {
      const { contract, consumer, jobId } = await loadFixture(deployFixture);

      await contract.connect(consumer).registerJob(jobId);
      await expect(contract.connect(consumer).registerJob(jobId))
        .to.be.revertedWithCustomError(contract, "JobAlreadyExists");
    });
  });

  // ═════════════════════════════════════════════════════════════
  // 3. FUND DEPOSIT
  // ═════════════════════════════════════════════════════════════

  describe("Deposit Funds", function () {
    it("7. Consumer can deposit funds", async function () {
      const { contract, consumer, jobId, depositAmount } = await loadFixture(deployFixture);

      await contract.connect(consumer).registerJob(jobId);

      await expect(contract.connect(consumer).depositFunds(jobId, { value: depositAmount }))
        .to.emit(contract, "FundsDeposited")
        .withArgs(jobId, consumer.address, depositAmount);

      const job = await contract.getJob(jobId);
      expect(job.payment).to.equal(depositAmount);
      expect(job.status).to.equal(2); // FUNDED
    });

    it("8. Wrong user cannot deposit", async function () {
      const { contract, consumer, outsider, jobId, depositAmount } = await loadFixture(deployFixture);

      await contract.connect(consumer).registerJob(jobId);

      await expect(
        contract.connect(outsider).depositFunds(jobId, { value: depositAmount })
      ).to.be.revertedWithCustomError(contract, "Unauthorized");
    });

    it("9. Zero deposit rejected", async function () {
      const { contract, consumer, jobId } = await loadFixture(deployFixture);

      await contract.connect(consumer).registerJob(jobId);

      await expect(
        contract.connect(consumer).depositFunds(jobId, { value: 0 })
      ).to.be.revertedWithCustomError(contract, "InvalidAmount");
    });

    it("10. Funds are locked in contract", async function () {
      const { contract, consumer, jobId, depositAmount } = await loadFixture(deployFixture);

      await contract.connect(consumer).registerJob(jobId);
      await contract.connect(consumer).depositFunds(jobId, { value: depositAmount });

      const balance = await contract.getEscrowBalance();
      expect(balance).to.equal(depositAmount);
    });
  });

  // ═════════════════════════════════════════════════════════════
  // 4. PROVIDER ASSIGNMENT
  // ═════════════════════════════════════════════════════════════

  describe("Assign Provider", function () {
    it("11. Operator can assign a provider to a funded job", async function () {
      const { contract, consumer, operator, provider, jobId, depositAmount } = await loadFixture(deployFixture);

      await advanceToFunded(contract, consumer, operator, jobId, depositAmount);

      await expect(contract.connect(operator).assignJob(jobId, provider.address))
        .to.emit(contract, "JobAssigned")
        .withArgs(jobId, provider.address);

      const job = await contract.getJob(jobId);
      expect(job.provider).to.equal(provider.address);
      expect(job.status).to.equal(3); // ASSIGNED
    });

    it("12. Non-operator cannot assign provider", async function () {
      const { contract, consumer, operator, provider, outsider, jobId, depositAmount } = await loadFixture(deployFixture);

      await advanceToFunded(contract, consumer, operator, jobId, depositAmount);

      await expect(
        contract.connect(outsider).assignJob(jobId, provider.address)
      ).to.be.revertedWithCustomError(contract, "Unauthorized");
    });

    it("13. Assignment before funding rejected", async function () {
      const { contract, consumer, operator, provider, jobId } = await loadFixture(deployFixture);

      await contract.connect(consumer).registerJob(jobId);

      await expect(
        contract.connect(operator).assignJob(jobId, provider.address)
      ).to.be.revertedWithCustomError(contract, "InvalidStatus");
    });

    it("14. Zero address provider rejected", async function () {
      const { contract, consumer, operator, jobId, depositAmount } = await loadFixture(deployFixture);

      await advanceToFunded(contract, consumer, operator, jobId, depositAmount);

      await expect(
        contract.connect(operator).assignJob(jobId, ethers.ZeroAddress)
      ).to.be.revertedWithCustomError(contract, "InvalidAddress");
    });
  });

  // ═════════════════════════════════════════════════════════════
  // 5. RESULT SUBMISSION
  // ═════════════════════════════════════════════════════════════

  describe("Submit Result", function () {
    it("15. Assigned provider can submit result", async function () {
      const { contract, consumer, operator, provider, jobId, depositAmount, resultHash } = await loadFixture(deployFixture);

      await advanceToAssigned(contract, consumer, operator, provider, jobId, depositAmount);

      await expect(contract.connect(provider).submitResult(jobId, resultHash))
        .to.emit(contract, "ResultSubmitted")
        .withArgs(jobId, provider.address, resultHash);

      const job = await contract.getJob(jobId);
      expect(job.resultHash).to.equal(resultHash);
      expect(job.status).to.equal(4); // RESULT_SUBMITTED
    });

    it("16. Wrong provider cannot submit result", async function () {
      const { contract, consumer, operator, provider, outsider, jobId, depositAmount, resultHash } = await loadFixture(deployFixture);

      await advanceToAssigned(contract, consumer, operator, provider, jobId, depositAmount);

      await expect(
        contract.connect(outsider).submitResult(jobId, resultHash)
      ).to.be.revertedWithCustomError(contract, "Unauthorized");
    });

    it("17. Empty result hash rejected", async function () {
      const { contract, consumer, operator, provider, jobId, depositAmount } = await loadFixture(deployFixture);

      await advanceToAssigned(contract, consumer, operator, provider, jobId, depositAmount);

      await expect(
        contract.connect(provider).submitResult(jobId, ethers.ZeroHash)
      ).to.be.revertedWithCustomError(contract, "InvalidResultHash");
    });
  });

  // ═════════════════════════════════════════════════════════════
  // 6. RESULT VERIFICATION
  // ═════════════════════════════════════════════════════════════

  describe("Verify Result", function () {
    it("18. Correct result hash verification passes", async function () {
      const { contract, consumer, operator, provider, jobId, depositAmount, resultHash } = await loadFixture(deployFixture);

      await advanceToResultSubmitted(contract, consumer, operator, provider, jobId, depositAmount, resultHash);

      await expect(contract.connect(operator).verifyResult(jobId, resultHash))
        .to.emit(contract, "ResultVerified")
        .withArgs(jobId, resultHash);

      const job = await contract.getJob(jobId);
      expect(job.status).to.equal(5); // VERIFIED
    });

    it("19. Wrong hash verification rejected", async function () {
      const { contract, consumer, operator, provider, jobId, depositAmount, resultHash } = await loadFixture(deployFixture);

      await advanceToResultSubmitted(contract, consumer, operator, provider, jobId, depositAmount, resultHash);

      const wrongHash = ethers.keccak256(ethers.toUtf8Bytes("wrong_data"));
      await expect(
        contract.connect(operator).verifyResult(jobId, wrongHash)
      ).to.be.revertedWithCustomError(contract, "ResultHashMismatch");
    });
  });

  // ═════════════════════════════════════════════════════════════
  // 7. PAYMENT RELEASE
  // ═════════════════════════════════════════════════════════════

  describe("Release Payment", function () {
    it("20. Payment releases to provider after verification", async function () {
      const { contract, consumer, operator, provider, jobId, depositAmount, resultHash } = await loadFixture(deployFixture);

      await advanceToVerified(contract, consumer, operator, provider, jobId, depositAmount, resultHash);

      const providerBalanceBefore = await ethers.provider.getBalance(provider.address);

      await expect(contract.connect(operator).releasePayment(jobId))
        .to.emit(contract, "PaymentReleased")
        .withArgs(jobId, provider.address, depositAmount);

      const providerBalanceAfter = await ethers.provider.getBalance(provider.address);
      expect(providerBalanceAfter - providerBalanceBefore).to.equal(depositAmount);

      const job = await contract.getJob(jobId);
      expect(job.status).to.equal(6); // COMPLETED
      expect(job.paymentReleased).to.equal(true);
    });

    it("21. Payment release before verification rejected", async function () {
      const { contract, consumer, operator, provider, jobId, depositAmount, resultHash } = await loadFixture(deployFixture);

      await advanceToResultSubmitted(contract, consumer, operator, provider, jobId, depositAmount, resultHash);

      await expect(
        contract.connect(operator).releasePayment(jobId)
      ).to.be.revertedWithCustomError(contract, "InvalidStatus");
    });

    it("22. Provider receives correct amount", async function () {
      const { contract, consumer, operator, provider, jobId, resultHash } = await loadFixture(deployFixture);

      const specificAmount = ethers.parseEther("2.5");
      await contract.connect(consumer).registerJob(jobId);
      await contract.connect(consumer).depositFunds(jobId, { value: specificAmount });
      await contract.connect(operator).assignJob(jobId, provider.address);
      await contract.connect(provider).submitResult(jobId, resultHash);
      await contract.connect(operator).verifyResult(jobId, resultHash);

      const balanceBefore = await ethers.provider.getBalance(provider.address);

      await contract.connect(operator).releasePayment(jobId);

      const balanceAfter = await ethers.provider.getBalance(provider.address);
      expect(balanceAfter - balanceBefore).to.equal(specificAmount);
    });

    it("23. Double payment release rejected", async function () {
      const { contract, consumer, operator, provider, jobId, depositAmount, resultHash } = await loadFixture(deployFixture);

      await advanceToVerified(contract, consumer, operator, provider, jobId, depositAmount, resultHash);
      await contract.connect(operator).releasePayment(jobId);

      // Second release should fail — status is now COMPLETED
      await expect(
        contract.connect(operator).releasePayment(jobId)
      ).to.be.revertedWithCustomError(contract, "InvalidStatus");
    });
  });

  // ═════════════════════════════════════════════════════════════
  // 8. REFUND
  // ═════════════════════════════════════════════════════════════

  describe("Refund", function () {
    it("24. Refund works from FUNDED state", async function () {
      const { contract, consumer, operator, jobId, depositAmount } = await loadFixture(deployFixture);

      await advanceToFunded(contract, consumer, operator, jobId, depositAmount);

      const consumerBalanceBefore = await ethers.provider.getBalance(consumer.address);

      await expect(contract.connect(operator).refund(jobId))
        .to.emit(contract, "RefundIssued")
        .withArgs(jobId, consumer.address, depositAmount);

      const consumerBalanceAfter = await ethers.provider.getBalance(consumer.address);
      expect(consumerBalanceAfter - consumerBalanceBefore).to.equal(depositAmount);

      const job = await contract.getJob(jobId);
      expect(job.status).to.equal(7); // REFUNDED
    });

    it("25. Unauthorized refund rejected", async function () {
      const { contract, consumer, operator, outsider, jobId, depositAmount } = await loadFixture(deployFixture);

      await advanceToFunded(contract, consumer, operator, jobId, depositAmount);

      await expect(
        contract.connect(outsider).refund(jobId)
      ).to.be.revertedWithCustomError(contract, "Unauthorized");
    });

    it("26. Double refund rejected (status is REFUNDED, not FUNDED/ASSIGNED/RESULT_SUBMITTED)", async function () {
      const { contract, consumer, operator, jobId, depositAmount } = await loadFixture(deployFixture);

      await advanceToFunded(contract, consumer, operator, jobId, depositAmount);
      await contract.connect(operator).refund(jobId);

      // Second refund should fail — status is now REFUNDED
      await expect(
        contract.connect(operator).refund(jobId)
      ).to.be.revertedWithCustomError(contract, "InvalidStatus");
    });

    it("27. Refund from ASSIGNED state works", async function () {
      const { contract, consumer, operator, provider, jobId, depositAmount } = await loadFixture(deployFixture);

      await advanceToAssigned(contract, consumer, operator, provider, jobId, depositAmount);

      await expect(contract.connect(operator).refund(jobId))
        .to.emit(contract, "RefundIssued");

      const job = await contract.getJob(jobId);
      expect(job.status).to.equal(7); // REFUNDED
    });

    it("28. Refund from RESULT_SUBMITTED state works", async function () {
      const { contract, consumer, operator, provider, jobId, depositAmount, resultHash } = await loadFixture(deployFixture);

      await advanceToResultSubmitted(contract, consumer, operator, provider, jobId, depositAmount, resultHash);

      await expect(contract.connect(operator).refund(jobId))
        .to.emit(contract, "RefundIssued");
    });
  });

  // ═════════════════════════════════════════════════════════════
  // 9. INVALID STATE TRANSITIONS
  // ═════════════════════════════════════════════════════════════

  describe("Invalid State Transitions", function () {
    it("29. Cannot deposit on already-funded job", async function () {
      const { contract, consumer, operator, jobId, depositAmount } = await loadFixture(deployFixture);

      await advanceToFunded(contract, consumer, operator, jobId, depositAmount);

      await expect(
        contract.connect(consumer).depositFunds(jobId, { value: depositAmount })
      ).to.be.revertedWithCustomError(contract, "InvalidStatus");
    });

    it("30. Cannot submit result for non-existent job", async function () {
      const { contract, provider, resultHash } = await loadFixture(deployFixture);

      const fakeJobId = ethers.keccak256(ethers.toUtf8Bytes("nonexistent_job"));
      await expect(
        contract.connect(provider).submitResult(fakeJobId, resultHash)
      ).to.be.revertedWithCustomError(contract, "JobDoesNotExist");
    });

    it("31. Cannot verify in ASSIGNED status (must be RESULT_SUBMITTED)", async function () {
      const { contract, consumer, operator, provider, jobId, depositAmount, resultHash } = await loadFixture(deployFixture);

      await advanceToAssigned(contract, consumer, operator, provider, jobId, depositAmount);

      await expect(
        contract.connect(operator).verifyResult(jobId, resultHash)
      ).to.be.revertedWithCustomError(contract, "InvalidStatus");
    });

    it("32. Cannot refund from REGISTERED state (no funds to refund)", async function () {
      const { contract, consumer, operator, jobId } = await loadFixture(deployFixture);

      await contract.connect(consumer).registerJob(jobId);

      await expect(
        contract.connect(operator).refund(jobId)
      ).to.be.revertedWithCustomError(contract, "InvalidStatus");
    });

    it("33. Cannot refund from COMPLETED state", async function () {
      const { contract, consumer, operator, provider, jobId, depositAmount, resultHash } = await loadFixture(deployFixture);

      await advanceToVerified(contract, consumer, operator, provider, jobId, depositAmount, resultHash);
      await contract.connect(operator).releasePayment(jobId);

      await expect(
        contract.connect(operator).refund(jobId)
      ).to.be.revertedWithCustomError(contract, "InvalidStatus");
    });
  });
  // ═════════════════════════════════════════════════════════════
  // 9. ROLE SEPARATION (provider ≠ operator, provider ≠ consumer)
  // ═════════════════════════════════════════════════════════════
  describe("Role Separation", function () {
    it("34. Operator cannot assign itself as provider", async function () {
      const { contract, operator, consumer, jobId, depositAmount } = await loadFixture(deployFixture);
      await advanceToFunded(contract, consumer, operator, jobId, depositAmount);
      await expect(contract.connect(operator).assignJob(jobId, operator.address))
        .to.be.revertedWithCustomError(contract, "InvalidProvider");
    });

    it("35. Job's consumer cannot be assigned as provider", async function () {
      const { contract, operator, consumer, jobId, depositAmount } = await loadFixture(deployFixture);
      await advanceToFunded(contract, consumer, operator, jobId, depositAmount);
      await expect(contract.connect(operator).assignJob(jobId, consumer.address))
        .to.be.revertedWithCustomError(contract, "InvalidProvider");
    });

    it("36. Check uses the current operator after setOperator", async function () {
      const { contract, owner, operator, consumer, outsider, jobId, depositAmount } = await loadFixture(deployFixture);
      await advanceToFunded(contract, consumer, operator, jobId, depositAmount);
      await contract.connect(owner).setOperator(outsider.address);
      await expect(contract.connect(outsider).assignJob(jobId, outsider.address))
        .to.be.revertedWithCustomError(contract, "InvalidProvider");
      // the previous operator is now an ordinary address and may be a provider
      await expect(contract.connect(outsider).assignJob(jobId, operator.address)).to.not.be.reverted;
      expect((await contract.getJob(jobId)).provider).to.equal(operator.address);
    });

    it("37. Rejected assignment leaves the job FUNDED with no provider", async function () {
      const { contract, operator, consumer, jobId, depositAmount } = await loadFixture(deployFixture);
      await advanceToFunded(contract, consumer, operator, jobId, depositAmount);
      await expect(contract.connect(operator).assignJob(jobId, operator.address)).to.be.reverted;
      const job = await contract.getJob(jobId);
      expect(job.status).to.equal(2n);              // FUNDED
      expect(job.provider).to.equal(ethers.ZeroAddress);
    });
  });

});
