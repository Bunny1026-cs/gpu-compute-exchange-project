# BDGCE viva questions

**What is distributed here?** The server schedules and verifies jobs; a separate
provider worker executes them and signs its own result commitment over the LAN.

**Which workloads are supported?** Bounded, seeded float32 square matrix multiplication,
size 2–1024. User-supplied Python and shell code are not executed.

**How is CUDA execution enforced?** The worker requires CUDA and launches a known-answer
kernel before registration. real_gpu never falls back; real_cpu_test is explicitly
development-only. Physical GPU evidence is still required for the final demonstration.

**How is correctness checked?** Worker and backend compare output to an independently
generated float64 CPU reference with rtol/atol 1e-4. Inputs use explicit seeded PCG64.

**What does SHA-256 prove?** Exact artifact-byte consistency. It does not prove that
arbitrary code executed correctly or establish remote physical GPU provenance.

**Why blockchain?** A local Solidity escrow enforces funding, provider assignment,
provider-only result submission, operator verification and one-time payment/refund.
It is a local-development demonstration, not a production economic system.

**Why separate wallets?** Consumer funds; provider signs submitResult; operator assigns,
verifies and releases. The deployer owns contract configuration. Keys stay out of UI.

**How are wei amounts represented?** Decimal strings in MongoDB and BigInt during
arithmetic and transactions. Payment amount comes from the confirmed event.

**What prevents double assignment?** Conditional MongoDB GPU claims, one activeJob per
slot, per-job operation locks, session binding and job-specific leases.

**What happens after a crash?** Signed backend transaction bytes are journaled before
broadcast; a retry rebroadcasts the same hash and reconciles receipts/events. Expired
worker jobs refund where the contract permits. Verified jobs settle rather than refund.

**How are chain resets handled?** Hardhat instance ID and contract address are persisted
with jobs. An old instance cannot be mistaken for funded state on a restarted chain.

**Is IPFS used?** The backend tries the local Kubo API after numerical verification.
It records a CID only after retrieving identical bytes from Kubo. Each job displays
its storage outcome. A verified local file supports retrieval when Kubo is unavailable.

**How are timings measured?** Monotonic host clocks; CUDA synchronization separates
warmup, host-to-device, kernel and device-to-host work. CPU and GPU data are labeled.

**Limitations?** Trusted private LAN, local test ETH, bounded workloads, one backend
process for wallet serialization, no remote hardware attestation, no production key
custody, no arbitrary-code sandbox, and physical two-laptop/GPU benchmarks pending.
