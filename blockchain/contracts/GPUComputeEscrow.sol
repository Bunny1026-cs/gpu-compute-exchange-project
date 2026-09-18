// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * @title GPUComputeEscrow
 * @notice Escrow and payment lifecycle for GPU Compute Exchange.
 *
 * This contract handles ONLY the trust/payment layer:
 *   - Job registration (consumer)
 *   - Fund deposit → escrow (consumer)
 *   - Provider assignment (backend/operator)
 *   - Result submission (provider)
 *   - Result verification (backend/operator)
 *   - Payment release → provider (backend/operator)
 *   - Refund → consumer (backend/operator)
 *
 * GPU computation NEVER happens on-chain. The blockchain only records
 * state transitions and holds/releases funds.
 *
 * State machines — blockchain vs application:
 *
 *   Blockchain (this contract)       MongoDB (application)
 *   ─────────────────────────        ──────────────────────
 *   REGISTERED                       CREATED
 *   FUNDED                           QUEUED
 *   ASSIGNED                         ASSIGNED
 *   RESULT_SUBMITTED                 RUNNING / RESULT_UPLOADED
 *   VERIFIED                         (no equivalent — trust layer)
 *   COMPLETED                        COMPLETED
 *   REFUNDED                         CANCELLED / FAILED
 *
 * Access control:
 *   - owner: deployer, can change operator
 *   - operator: backend service, can assign/verify/refund/release
 *   - consumer: registers job, deposits funds
 *   - provider: submits result for assigned job
 */

// ═══════════════════════════════════════════════════════════════
// Contract
// ═══════════════════════════════════════════════════════════════

contract GPUComputeEscrow {

    // ── Types ─────────────────────────────────────────────────
    enum JobStatus {
        NONE,               // 0 — job does not exist
        REGISTERED,         // 1 — consumer registered the job
        FUNDED,             // 2 — consumer deposited escrow funds
        ASSIGNED,           // 3 — operator assigned a provider
        RESULT_SUBMITTED,   // 4 — provider submitted a result hash
        VERIFIED,           // 5 — operator verified the result hash
        COMPLETED,          // 6 — payment released to provider
        REFUNDED            // 7 — funds refunded to consumer
    }

    struct Job {
        bytes32     jobId;
        address     consumer;
        address     provider;
        uint256     payment;
        bytes32     resultHash;
        JobStatus   status;
        bool        paymentReleased;
    }

    // ── State ─────────────────────────────────────────────────
    address public owner;
    address public operator;

    mapping(bytes32 => Job) public jobs;

    // Reentrancy lock (simple — no OpenZeppelin dependency needed)
    bool private _locked;

    // ── Events ────────────────────────────────────────────────
    event JobRegistered(bytes32 indexed jobId, address indexed consumer);
    event FundsDeposited(bytes32 indexed jobId, address indexed consumer, uint256 amount);
    event JobAssigned(bytes32 indexed jobId, address indexed provider);
    event ResultSubmitted(bytes32 indexed jobId, address indexed provider, bytes32 resultHash);
    event ResultVerified(bytes32 indexed jobId, bytes32 resultHash);
    event PaymentReleased(bytes32 indexed jobId, address indexed provider, uint256 amount);
    event RefundIssued(bytes32 indexed jobId, address indexed consumer, uint256 amount);
    event OperatorChanged(address indexed previousOperator, address indexed newOperator);

    // ── Errors ────────────────────────────────────────────────
    error Unauthorized();
    error JobAlreadyExists();
    error JobDoesNotExist();
    error InvalidStatus(JobStatus current, JobStatus expected);
    error InvalidAddress();
    error InvalidAmount();
    error InvalidResultHash();
    error ResultHashMismatch();
    error TransferFailed();
    error Reentrancy();
    error ProviderAlreadyAssigned();
    error AlreadyReleased();
    error AlreadyRefunded();

    // ── Modifiers ─────────────────────────────────────────────
    modifier onlyOwner() {
        if (msg.sender != owner) revert Unauthorized();
        _;
    }

    modifier onlyOperator() {
        if (msg.sender != operator) revert Unauthorized();
        _;
    }

    modifier nonReentrant() {
        if (_locked) revert Reentrancy();
        _locked = true;
        _;
        _locked = false;
    }

    modifier jobExists(bytes32 jobId) {
        if (jobs[jobId].status == JobStatus.NONE) revert JobDoesNotExist();
        _;
    }

    modifier inStatus(bytes32 jobId, JobStatus expected) {
        if (jobs[jobId].status != expected)
            revert InvalidStatus(jobs[jobId].status, expected);
        _;
    }

    // ── Constructor ───────────────────────────────────────────
    /**
     * @param _operator The backend/operator address that can assign, verify,
     *                  release, and refund. Typically the backend service wallet.
     */
    constructor(address _operator) {
        if (_operator == address(0)) revert InvalidAddress();
        owner = msg.sender;
        operator = _operator;
    }

    // ═══════════════════════════════════════════════════════════
    // Admin functions
    // ═══════════════════════════════════════════════════════════

    /**
     * @notice Change the operator address. Only the owner (deployer) can do this.
     * @param newOperator The new backend/operator address.
     */
    function setOperator(address newOperator) external onlyOwner {
        if (newOperator == address(0)) revert InvalidAddress();
        emit OperatorChanged(operator, newOperator);
        operator = newOperator;
    }

    // ═══════════════════════════════════════════════════════════
    // Consumer functions
    // ═══════════════════════════════════════════════════════════

    /**
     * @notice Register a new job on-chain. Consumer is msg.sender.
     * @param jobId Unique job identifier (typically keccak256 of the MongoDB ObjectId).
     */
    function registerJob(bytes32 jobId) external {
        if (jobs[jobId].status != JobStatus.NONE) revert JobAlreadyExists();

        jobs[jobId] = Job({
            jobId:           jobId,
            consumer:        msg.sender,
            provider:        address(0),
            payment:         0,
            resultHash:      bytes32(0),
            status:          JobStatus.REGISTERED,
            paymentReleased: false
        });

        emit JobRegistered(jobId, msg.sender);
    }

    /**
     * @notice Deposit escrow funds for a registered job.
     * @param jobId The job to fund.
     *
     * Requirements:
     *   - Only the job's consumer can deposit.
     *   - msg.value must be > 0.
     *   - Job must be in REGISTERED status.
     */
    function depositFunds(bytes32 jobId)
        external
        payable
        jobExists(jobId)
        inStatus(jobId, JobStatus.REGISTERED)
    {
        Job storage job = jobs[jobId];
        if (msg.sender != job.consumer) revert Unauthorized();
        if (msg.value == 0) revert InvalidAmount();

        job.payment = msg.value;
        job.status = JobStatus.FUNDED;

        emit FundsDeposited(jobId, msg.sender, msg.value);
    }

    // ═══════════════════════════════════════════════════════════
    // Operator functions
    // ═══════════════════════════════════════════════════════════

    /**
     * @notice Assign a GPU provider to a funded job.
     * @param jobId   The funded job.
     * @param provider The provider's wallet address.
     *
     * Only the operator (backend service) can call this.
     * Job must be FUNDED and have no provider yet.
     */
    function assignJob(bytes32 jobId, address provider)
        external
        onlyOperator
        jobExists(jobId)
        inStatus(jobId, JobStatus.FUNDED)
    {
        if (provider == address(0)) revert InvalidAddress();

        Job storage job = jobs[jobId];
        if (job.provider != address(0)) revert ProviderAlreadyAssigned();

        job.provider = provider;
        job.status = JobStatus.ASSIGNED;

        emit JobAssigned(jobId, provider);
    }

    // ═══════════════════════════════════════════════════════════
    // Provider functions
    // ═══════════════════════════════════════════════════════════

    /**
     * @notice Provider submits the result hash for an assigned job.
     * @param jobId      The assigned job.
     * @param resultHash SHA-256 or similar hash of the computation result.
     *
     * Only the assigned provider can submit.
     * Job must be ASSIGNED.
     */
    function submitResult(bytes32 jobId, bytes32 resultHash)
        external
        jobExists(jobId)
        inStatus(jobId, JobStatus.ASSIGNED)
    {
        if (resultHash == bytes32(0)) revert InvalidResultHash();

        Job storage job = jobs[jobId];
        if (msg.sender != job.provider) revert Unauthorized();

        job.resultHash = resultHash;
        job.status = JobStatus.RESULT_SUBMITTED;

        emit ResultSubmitted(jobId, msg.sender, resultHash);
    }

    // ═══════════════════════════════════════════════════════════
    // Verification + Payment
    // ═══════════════════════════════════════════════════════════

    /**
     * @notice Verify the submitted result hash.
     * @param jobId              The job to verify.
     * @param expectedResultHash The hash the verifier expects.
     *
     * Only the operator can verify. Job must be RESULT_SUBMITTED.
     * Reverts if hashes do not match.
     */
    function verifyResult(bytes32 jobId, bytes32 expectedResultHash)
        external
        onlyOperator
        jobExists(jobId)
        inStatus(jobId, JobStatus.RESULT_SUBMITTED)
    {
        Job storage job = jobs[jobId];
        if (job.resultHash != expectedResultHash) revert ResultHashMismatch();

        job.status = JobStatus.VERIFIED;

        emit ResultVerified(jobId, expectedResultHash);
    }

    /**
     * @notice Release escrowed payment to the provider after verification.
     * @param jobId The verified job.
     *
     * Only the operator can release. Uses checks-effects-interactions pattern.
     * Reentrancy-guarded.
     */
    function releasePayment(bytes32 jobId)
        external
        onlyOperator
        jobExists(jobId)
        inStatus(jobId, JobStatus.VERIFIED)
        nonReentrant
    {
        Job storage job = jobs[jobId];
        if (job.provider == address(0)) revert InvalidAddress();
        if (job.paymentReleased) revert AlreadyReleased();
        if (job.payment == 0) revert InvalidAmount();

        // ── Checks-effects-interactions ─────────────────────
        uint256 amount = job.payment;

        // Effects (state changes before external call)
        job.paymentReleased = true;
        job.status = JobStatus.COMPLETED;

        // Interaction (external call)
        (bool success, ) = payable(job.provider).call{value: amount}("");
        if (!success) revert TransferFailed();

        emit PaymentReleased(jobId, job.provider, amount);
    }

    // ═══════════════════════════════════════════════════════════
    // Refund
    // ═══════════════════════════════════════════════════════════

    /**
     * @notice Refund escrowed funds to the consumer.
     * @param jobId The job to refund.
     *
     * Only the operator can refund.
     * Refundable states: FUNDED, ASSIGNED, RESULT_SUBMITTED.
     *   - FUNDED:           provider never assigned, job cancelled
     *   - ASSIGNED:         provider assigned but never submitted result (timeout/failure)
     *   - RESULT_SUBMITTED: result verification failed off-chain
     *
     * Cannot refund: NONE, REGISTERED, VERIFIED, COMPLETED, REFUNDED.
     *   - REGISTERED: no funds deposited
     *   - VERIFIED:   should proceed to payment
     *   - COMPLETED:  already paid
     *   - REFUNDED:   already refunded
     */
    function refund(bytes32 jobId)
        external
        onlyOperator
        jobExists(jobId)
        nonReentrant
    {
        Job storage job = jobs[jobId];

        // Only refundable in these states
        if (
            job.status != JobStatus.FUNDED &&
            job.status != JobStatus.ASSIGNED &&
            job.status != JobStatus.RESULT_SUBMITTED
        ) {
            revert InvalidStatus(job.status, JobStatus.FUNDED); // generic "not refundable"
        }

        if (job.paymentReleased) revert AlreadyReleased();
        if (job.payment == 0) revert InvalidAmount();

        // ── Checks-effects-interactions ─────────────────────
        uint256 amount = job.payment;

        // Effects
        job.status = JobStatus.REFUNDED;

        // Interaction
        (bool success, ) = payable(job.consumer).call{value: amount}("");
        if (!success) revert TransferFailed();

        emit RefundIssued(jobId, job.consumer, amount);
    }

    // ═══════════════════════════════════════════════════════════
    // View functions
    // ═══════════════════════════════════════════════════════════

    /**
     * @notice Get the full job details.
     */
    function getJob(bytes32 jobId) external view returns (Job memory) {
        return jobs[jobId];
    }

    /**
     * @notice Get the contract's total escrowed balance.
     */
    function getEscrowBalance() external view returns (uint256) {
        return address(this).balance;
    }
}
