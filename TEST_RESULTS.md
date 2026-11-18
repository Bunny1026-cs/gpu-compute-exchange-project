# Actual test results

Implementation checkpoint: `905187b` on `implementation/real-compute-workflow`.
Evidence files retain their original recordedAt timestamps. Session/server restarts
occurred during work; they are not counted as successful tests.

## Executed checks

| Check | Actual outcome |
| --- | --- |
| Backend `npm.cmd test` | 87 passed, zero failures (82 preserved + 5 new real-compute tests) |
| Contract `npm.cmd test` | 37 passed |
| Worker `python -m unittest discover -s tests -v` | 24 passed (17 preserved + 7 matrix tests) |
| Frontend `npm.cmd run build` | Passed |
| Frontend `npm.cmd run lint` | Passed |
| Python syntax compilation | matrix_workload.py and runner.py passed |
| Local MongoDB | Connected; real persistent job/GPU/receipt data |
| Hardhat deployment | Actual GPUComputeEscrow deployed; separate operator/consumer/provider accounts |
| `node ops/integration.cjs 5` on latest receipt code | Five genuine CPU jobs passed, plus real queued-job refund |
| `node ops/security-integration.cjs` | 23 distinct live checks passed |
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
- `evidence/security-integration.json`: 23 named checks and actual worker-failure refund.
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
