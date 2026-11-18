# Actual test results

## November 18 local acceptance run

On the working tree based on `165b01e`, Laptop 1 ran MongoDB 7, a freshly deployed
Hardhat escrow, Express, Vite, a native PyTorch CPU worker and an offline Kubo 0.32.1
daemon. The application rehearsal used a separate MongoDB database.

| Executed check | Outcome |
| --- | --- |
| Backend / Solidity / worker regression suites | 90 / 37 / 25 passed. The worker suite also checked OS lock exclusion and release using a test device identifier. |
| Frontend production build and lint | Both exited successfully. |
| Kubo available | Five jobs paid exactly their quoted escrow. Each verified NumPy download matched a direct Kubo binary read and its SHA-256. Five modified temporary copies failed integrity checks. |
| Kubo stopped | One additional job paid and returned a verified local file with a null CID. Its modified copy failed integrity checks. |
| Independent MongoDB and chain audit | All six collector jobs had matching database and contract status, result commitment, released wei, and released reservation. Each had six successful, event-matched receipts from the expected consumer, operator and provider signers. |
| Browser registration | Fresh consumer and provider registrations reached their respective dashboards. The final Kubo walkthrough then repeated funding, payment, verified download, refund, and offline slot management. |
| Consumer and provider browser walkthrough | Two separate browser sessions logged in. The consumer submitted, funded, previewed and downloaded its output. The provider saw the matching payment receipt. The local-file run also exercised a queued-job refund and offline slot creation, credential issuance, editing and retirement. Both browser reports recorded zero uncaught page errors. |
| Concurrent funding, job ownership, result validation and refunds | 28 live security and reliability checks passed. A separate expired-lease exercise produced an on-chain refund and cleared the reservation. |
| Reset protection and clean reset | The CLI refused the active deployment. In a disposable MongoDB container connected to the real Hardhat RPC, it also refused a current-instance job, cleared seeded prior-instance records and reservations, and preserved both backend and worker artifact bytes in timestamped backups. |
| Laptop 1 preflight | Loopback HTTP check passed. CUDA check failed as expected with CPU-only PyTorch. |

Raw receipts, file digests, per-job timing, browser screenshots and the preflight
report are under [the November 18 rehearsal](evidence/rehearsal-20261118/).
Physical CUDA, cross-laptop LAN and the final recorded demonstration remain **NOT VERIFIED**.

## Earlier revision

Initial implementation checkpoint: `905187b` on `implementation/real-compute-workflow`.
Evidence files retain their original recordedAt timestamps. Session/server restarts
occurred during work; they are not counted as successful tests.

## Executed checks

| Check | Actual outcome |
| --- | --- |
| Backend `npm.cmd test` | 89 passed, zero failures (82 preserved + 7 real-compute tests) |
| Contract `npm.cmd test` | 37 passed |
| Worker `python -m unittest discover -s tests -v` | 24 passed (17 preserved + 7 matrix tests) |
| Frontend `npm.cmd run build` | Passed |
| Frontend `npm.cmd run lint` | Passed |
| Python syntax compilation | matrix_workload.py and runner.py passed |
| Local MongoDB | Connected; real persistent job/GPU/receipt data |
| Hardhat deployment | Actual GPUComputeEscrow deployed; separate operator/consumer/provider accounts |
| `node ops/integration.cjs 5` on latest receipt code | Five genuine CPU jobs passed, plus real queued-job refund |
| `node ops/security-integration.cjs` | 28 distinct live checks passed |
| Browser consumer workflow | Login, create 64×64 job, fund, view completed status/payment/artifact controls passed |
| Browser console inspection | Zero errors during tested consumer workflow |
| Provider browser controls | Login, register slot, issue/hide credential, edit INACTIVE status passed |
| Git whitespace check | Passed |
| Live lease recovery | Accelerated dedicated job expiry; actual periodic cycle refunded escrow and released reservation |
| Laptop 1 CUDA preflight | Correct failure: Intel UHD 620, CPU-only PyTorch, no CUDA |

Live services were run: MongoDB 7, Hardhat 31337, Express backend, Vite frontend and
native Python real_cpu_test worker. Public-chain tests, CUDA execution and physical
cross-laptop traffic were not performed.

## Live evidence

- `evidence/cpu-integration.json`: five latest CPU runs, full metadata, hashes,
  numerical verification, transaction hashes, gas, event amounts, queue/end-to-end times.
- `evidence/cpu-integration.csv`: derived directly from those recorded samples.
- `evidence/cpu-refund.json`: actual RefundIssued receipt for an incompatible request.
- `evidence/security-integration.json`: 28 named checks and actual worker-failure refund.
- `evidence/consumer-completed.png`: browser screenshot of a completed CPU test job.
- Earlier pre-fix integration evidence is retained with `before-receipt-fix` suffix.

Each latest run verified AWAITING_FUNDING before funding, rejected provider attempts
to fund a consumer job, reached COMPLETED only after successful chain settlement,
matched downloaded bytes to SHA-256, found ResultSubmitted and PaymentReleased
receipts, matched event payment to quoted wei, retried settlement without another
payment, and confirmed the slot's activeJob reservation was cleared.

Live security checks rejected invalid credentials, a second worker session, another
slot's credential, invalid lease, arbitrary workload, settlement without an artifact,
wrong SHA-256 and a numerically incorrect artifact carrying its correct hash.
Concurrent funding had one winner. Unfunded work stayed out of scheduling. Rejected
artifacts left the job running. Intentional worker failure refunded escrow and a
late worker could not restart that job.

## Failures found and corrected

- MongoDB omits empty objects by default; specification hashing now normalizes
  absent empty requirements before comparison.
- Receipt action names are updated from actual events, avoiding duplicate displayed
  records for method/event names sharing a transaction hash.
- Local ethers caching caused stale state/receipt observations and delayed retries;
  caching is disabled and mined receipts are polled directly. Latest five runs pass.
- The security harness blocked its own event loop while importing PyTorch and then
  reused an expired HTTP keepalive socket; test requests now close connections.
- Interrupted benchmark runs retained raw completed samples. No interrupted run is
  described as a completed three-size benchmark.

## Not physically verified / limits

CUDA workload and memory/timing code is implemented and CPU/no-fallback/error behavior
is tested. Physical CUDA, actual GPU OOM, driver/architecture compatibility, Laptop 2
network/firewall and GPU benchmarks remain NOT VERIFIED. Unit tests use mocks for
CUDA-error and timeout paths and do not count as hardware evidence.

Hardhat instance-reset rejection is unit tested. Abrupt crash/restart at every
transaction boundary, full wall-clock lease-expiry timing, reset procedure and all
provider browser recovery paths have not received exhaustive live fault-injection tests.
The software is a local demonstration with one backend process; it is not a
production distributed wallet service or remote hardware attestation system.

See MILESTONE2_RESULTS.md and evidence/milestone2 for the latest Milestone 2 tests and recovery changes.
