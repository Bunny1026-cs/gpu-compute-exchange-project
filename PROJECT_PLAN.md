# BDGCE — Final Major Project Completion and Real Two-Laptop Demonstration

## Codex Configuration

Before starting, I will select these settings in VS Code:

- **Mode:** Agent
- **Model:** Strongest available Codex coding model
- **Reasoning effort:** High
- **Execution:** Local VS Code workspace
- **Permissions:** Workspace file editing and terminal execution, with approval for sensitive operations

Use High reasoning for hardware integration, distributed communication, blockchain settlement, and debugging. Medium is sufficient for straightforward frontend tasks.

Work carefully and verify actual behavior rather than making assumptions.

## 1. Project Overview

You are working inside my existing repository:

https://github.com/Bunny1026-cs/gpu-compute-exchange-project

**Project title:** Blockchain-Enabled Distributed GPU Compute Exchange for High-Performance Workloads.

This is my college engineering major project.

**Main objective:** Complete a genuinely working distributed GPU-computing marketplace that I can demonstrate using **two physically separate laptops**, with actual GPU execution, real computed outputs, working local blockchain escrow, and genuine performance measurements.

This is not a new project. Extend and complete the existing codebase.

### Existing Technologies

- React/Vite frontend
- Node.js/Express backend
- MongoDB/Mongoose
- Greedy GPU scheduling
- Python worker
- IPFS integration
- Solidity `GPUComputeEscrow`
- Hardhat blockchain
- Docker Compose

Previous work fixed important security, scheduling concurrency, GPU-state, validation, nonce, contract-role, and worker-lifecycle issues.

Preserve the existing functionality and working tests.

**Do not rebuild the application, unnecessarily redesign the UI, or modify my finalized IEEE paper.**

## 2. Required Two-Laptop Architecture

### Laptop 1 — Main Server

Codex is running in VS Code on this laptop.

It hosts:

- React frontend
- Express backend and scheduler
- MongoDB
- Hardhat blockchain
- Escrow contract
- Result storage
- Backend-managed local demo consumer wallet
- Separate blockchain operator wallet

### Laptop 2 — GPU Provider

It hosts:

- Provider dashboard in a browser
- Python worker
- Physical NVIDIA GPU, if supported
- PyTorch/CUDA execution environment
- Provider-specific worker credentials
- Separate provider development wallet

Both laptops communicate through a private Wi-Fi hotspot or LAN.

The worker on Laptop 2 connects to Laptop 1's backend using its LAN address, not `localhost`.

The worker uploads results to the backend; only the backend accesses the local IPFS API.

For provider-signed blockchain transactions, configure Laptop 2 to access Laptop 1's Hardhat RPC through the trusted LAN. Restrict access with firewall rules and never expose development keys or the RPC publicly.

**Important:** Codex can access only the laptop/workspace where it runs. It must provide exact commands for me to execute on Laptop 2 and use the actual outputs I share.

## 3. Non-Negotiable Requirements

1. No simulated GPU execution or fake computation results in the final demo.
2. No artificial execution delays, fabricated performance data, mock blockchain payment success, or hard-coded dashboard measurements.
3. Real computational work must run on a physical GPU.
4. Use `EXECUTION_MODE=real_gpu`. The final demo must reject simulated execution mode.
5. Native Python/PyTorch execution is preferred; Docker GPU execution is optional.
6. Use local Hardhat test ETH only, not real money.
7. Use separate consumer, provider, and operator wallet identities.
8. Keep private keys and credentials in ignored environment files.
9. Store wei values using BigInt or decimal strings, never JavaScript floating-point numbers.
10. Do not run arbitrary user-supplied shell commands or Python code; use allowlisted workloads.
11. Preserve existing fixes and regression tests.
12. Make small, verified changes rather than a huge untested rewrite.

Unit tests may use mocks, but physical demonstration results and performance measurements must come from actual execution.

## 4. Development Strategy

Complete the project in **four milestones**.

For each milestone:

- Inspect existing functionality before editing.
- Make the minimum necessary implementation changes.
- Run relevant tests.
- Fix regressions.
- Record actual evidence.
- Report what works and what remains.
- Stop at the checkpoint before proceeding.

Do not attempt all four milestones in one enormous change.

---

# Milestone 1 — Real GPU Execution and Network Verification

**Goal:** Confirm that real GPU execution is possible and implement one genuine computational workload.

### Step 1: Verify the Existing Project

Inspect:

- Current source code and Git status.
- Backend, scheduler, worker, frontend and blockchain integration.
- Existing test scripts.
- Node.js, Python and relevant package versions.
- MongoDB and Hardhat availability.

Create a safe development branch without losing my current work.

### Step 2: Verify Both Laptops

Provide exact commands for Laptop 2 to check:

- Operating system.
- NVIDIA GPU model.
- GPU memory.
- NVIDIA driver.
- PyTorch installation.
- `torch.cuda.is_available()`.
- `torch.version.cuda`.
- Actual supported GPU architecture.
- Real CUDA computation.

Do not treat the CUDA version displayed by `nvidia-smi` as proof that PyTorch works.

Verify a known-answer CUDA matrix multiplication.

Also verify that Laptop 2 can access Laptop 1's backend over the LAN.

If Laptop 2 has no compatible GPU, determine whether the two machines can exchange server/provider roles.

If neither machine supports actual GPU computing, **stop and report the hardware limitation**. Do not create fake GPU results.

### Step 3: Implement Real GPU Matrix Multiplication

Implement a real PyTorch/CUDA workload.

Requirements:

- Generate reproducible matrices on the CPU.
- Transfer inputs to the GPU.
- Execute actual GPU matrix multiplication.
- Retrieve the computed result.
- Verify the numerical output against a CPU reference within appropriate floating-point tolerance.
- Record GPU device, matrix dimensions, dtype, memory usage, execution time and result metadata.
- Save actual output using a safe format such as `.npy`, without pickle.
- Use a subprocess with a timeout.
- Handle CUDA out-of-memory and execution errors.
- Warm up CUDA before regular measurements.
- Measure host-to-device transfer, kernel execution and device-to-host transfer separately where possible.

The output must be generated by actual computation, not fabricated numerical values.

### Milestone 1 Acceptance

A genuine CUDA workload successfully executes on a physical GPU and produces a numerically verified result.

**STOP after Milestone 1. Report the evidence and wait for my instruction before Milestone 2.**

---

# Milestone 2 — Remote Worker, Scheduler and Complete Blockchain Escrow

**Goal:** Make a real job move between the two laptops and complete its blockchain payment lifecycle.

## A. Remote GPU Worker

Implement:

- Provider account and real GPU registration.
- GPU information reported by the physical worker.
- Provider-specific worker authentication.
- Worker-to-provider/GPU binding.
- Periodic heartbeat.
- Online/offline status.
- GPU requirement validation.
- Real remote job polling and execution.
- Conditional job assignment.
- One active job per GPU.
- Job lease identifiers to reject late or stale worker submissions.
- Worker disconnect detection and safe recovery.

Preserve the existing greedy scheduler and improve it only where needed for physical GPU matching.

Use actual heartbeat-reported capabilities rather than trusting arbitrary manually entered GPU metadata.

## B. Consumer Funding

For this college demonstration, use a **backend-managed demo consumer wallet**.

Do not introduce MetaMask unless the existing application already supports it reliably.

Clearly label funding in the UI:

**Fund with Demo Wallet**

Use a simple local test-ETH reservation model:

`jobPriceWei = rateWeiPerMinute × reservedMinutes`

Show the configured rate, reserved duration and total amount before funding.

The backend must execute actual blockchain transactions and verify successful receipts and events before marking a job as funded.

Do not confuse demo test ETH with real marketplace currency.

## C. Provider Wallet and Payment

- Configure a separate provider development wallet.
- Ensure it has sufficient local test ETH for transaction gas.
- Register the correct provider wallet address.
- After genuine GPU execution, have the provider sign `submitResult`.
- Normalize the SHA-256 commitment to Solidity `bytes32`.
- Perform operator verification using the contract's actual access-control rules.
- Release payment using the contract.
- Confirm transaction success using the receipt and contract state.
- Record actual transaction hashes and gas used.
- Read the payment event to determine the released amount rather than relying on wallet-balance differences.

## D. Application State Management

Use this lifecycle:

`AWAITING_FUNDING → QUEUED → ASSIGNED → RUNNING → RESULT_UPLOADED → SETTLEMENT_PENDING → COMPLETED`

Also support:

- `FAILED`
- `REFUND_PENDING`
- `REFUNDED`

Keep the existing blockchain state machine and correctly map its state to the application.

**An escrowed job must never display COMPLETED or PAID unless successful on-chain payment release is confirmed.**

## E. Reliability

Implement practical safeguards:

- No assignment before funding confirmation.
- No two jobs using the same GPU simultaneously.
- No double completion or double payment.
- No acceptance of a stale worker's result.
- No modification of a funded workload specification.
- No silent success after an RPC or contract failure.
- Safe GPU release on failure.
- Operator-authorized refunds where permitted.
- Same-worker retry where safe; do not invent unsupported reassignment.
- Persistent transaction records and receipt reconciliation.
- Detection of Hardhat state resets so stale database records are not treated as funded.

Keep recovery simple and reliable for the college demo.

### Milestone 2 Acceptance

A genuine job submitted on Laptop 1 is assigned to Laptop 2, executed using its physical GPU, and completed with real local blockchain transaction receipts and payment release.

**STOP and report verified results before continuing.**

---

# Milestone 3 — Real Results, Storage and Complete UI

**Goal:** Operate the entire application through the existing browser interface without manually calling backend APIs.

## A. Consumer Dashboard

Complete:

- Registration and login.
- Available GPU listing.
- Real workload selection.
- Matrix size and requirement selection.
- Price quotation.
- Demo wallet escrow funding.
- Job queue and assignment status.
- Execution progress.
- Actual GPU execution details.
- Result retrieval.
- Payment and transaction status.
- Proper error messages.

## B. Provider Dashboard

Complete:

- Login.
- Physical GPU registration and verification.
- Worker online/offline status.
- GPU details and availability.
- Job assignments.
- Live execution state.
- Real result details.
- Payment completion and transaction receipt.

Preserve the existing UI design.

## C. Result Integrity

Implement:

1. Exact-byte SHA-256 hashing of output artifacts.
2. Backend verification of uploaded bytes against the submitted hash.
3. Immutable workload parameters after funding.
4. Stored workload specification hash.
5. Actual artifact storage and retrieval.
6. Correct `bytes32` commitment for the smart contract.
7. Numerical correctness checks for supported workloads.

Do not hash reserialized JSON inconsistently.

A matching hash proves data consistency, not arbitrary computation correctness.

## D. Storage

Use actual local IPFS/Kubo if it is available and working.

The worker uploads to the backend, and the backend communicates with IPFS.

If real IPFS is unavailable, use clearly labeled local file storage with genuine uploaded artifacts.

Never fabricate an IPFS CID or claim local files were stored on IPFS.

## E. LAN Frontend

Ensure the application works from both laptops.

Use the actual LAN address and relative `/api` routes where practical.

Avoid hard-coded browser requests to `localhost` that would fail on Laptop 2.

### Milestone 3 Acceptance

The full consumer/provider workflow operates through the existing frontend, displays actual computation results and shows real transaction status.

**STOP and report before proceeding.**

---

# Milestone 4 — Real Experiments and Final Demonstration

**Goal:** Collect genuine technical results and prepare a dependable 10–15-minute major-project demonstration.

## A. Actual Experimental Evaluation

Measure:

1. GPU execution time.
2. CPU-versus-GPU execution time for identical workloads.
3. GPU memory usage.
4. Supported GPU utilization telemetry.
5. Scheduling latency.
6. Queue waiting time.
7. Network/result transfer time.
8. End-to-end job completion time.
9. Actual blockchain gas usage.
10. Local Hardhat transaction confirmation/receipt time.

Use synchronized GPU timing and monotonic clocks.

Never subtract timestamps from two laptops without accounting for clock differences.

Keep cold-start timing separate from warm execution.

For feasible experiments:

- Perform at least 10 warm GPU runs per selected workload size.
- Perform at least 5 complete end-to-end runs.
- Record every raw sample.
- Calculate median, minimum and maximum from the recorded measurements.
- Report sample counts.

Record:

- Git commit.
- GPU model.
- Operating system.
- Driver version.
- CUDA and PyTorch versions.
- Input dimensions.
- Dtype.
- Execution mode.
- Software/environment settings.

Use AC power and stable performance settings while benchmarking.

Generate CSV/JSON results and graphs directly from actual measurements.

Never invent timings, utilization, cloud-cost savings or benchmark improvements.

Local Hardhat gas and confirmation measurements must be labeled as local-development results, not public-network measurements.

## B. Final 10–15-Minute Demo

Prepare this exact demonstration:

1. Show both laptops connected over the LAN and the actual GPU detected.
2. Log in as provider and show the registered online GPU.
3. Log in as consumer and submit a real GPU workload.
4. Fund the job with the backend-managed demo wallet.
5. Show GPU matching and assignment to Laptop 2.
6. Show real computation executing on Laptop 2.
7. Show the genuine result received and verified on Laptop 1.
8. Show successful on-chain payment release, receipt, gas used and final job status.

Prepare one small failure scenario only if it has been tested reliably.

## C. Demo Reliability

Provide:

- Exact Laptop 1 startup commands.
- Exact Laptop 2 startup commands.
- Required environment variables.
- LAN/hotspot instructions.
- Firewall and connectivity checks.
- GPU preflight script.
- Application health checks.
- Demo user accounts and seeded test data.
- Clear troubleshooting commands.
- A safe demo reset procedure.
- A repeatable startup order.

The reset procedure must consistently handle local chain state, demo database records, GPU reservations and stored demo artifacts.

Make a backup demonstration recording only after the genuine full workflow succeeds.

## D. Required Final Documents

Create inside the existing repository:

- `FINAL_DEMO_GUIDE.md` — complete startup and eight-step demo instructions.
- `TEST_RESULTS.md` — actual executed tests and outcomes.
- `PERFORMANCE_RESULTS.md` — genuine benchmark methodology and results.
- `VIVA_QA.md` — concise technical questions and answers covering GPU computation, scheduling, blockchain escrow, smart contracts, result verification, network communication, IPFS, security and limitations.
- Updated `README.md` and environment examples.
- Actual benchmark CSV/JSON files and generated charts.

## 5. Final Definition of Done

The project is complete only when:

- Two physically separate laptops communicate successfully.
- Laptop 2's actual GPU capabilities are detected.
- A real job is submitted from Laptop 1.
- The scheduler assigns the correct physical GPU.
- The remote worker executes an actual GPU computation.
- Genuine output is returned and numerically validated.
- The result is stored and retrievable.
- The backend verifies output integrity.
- Provider and operator transactions complete successfully.
- Payment release is confirmed by actual blockchain receipts.
- The GPU is released correctly after completion.
- Both dashboards display accurate states and results.
- Real performance measurements are recorded.
- The complete demo can be repeated reliably.

If anything cannot be physically tested, mark it **NOT VERIFIED** and provide exact verification steps. Never claim a test passed without executing it.

## 6. Immediate Instructions for Codex

**Start with Milestone 1 only.**

Inspect the existing VS Code workspace, verify the code and development environment, and create a safe Git checkpoint.

Then prepare and run the available hardware and network checks on Laptop 1.

Provide exact commands for me to run on Laptop 2 and use those actual outputs to determine GPU compatibility.

Implement the initial real GPU workload only after hardware capability is established.

Do not proceed into the complete blockchain integration until Milestone 1 succeeds and I instruct you to continue.

**Final objective: A practical, technically defensible college major project with two-laptop distributed GPU execution, genuine computation, actual local blockchain settlement, reproducible measured results, and a reliable final demonstration.**
