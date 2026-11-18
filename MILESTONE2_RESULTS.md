# Milestone 2 software checkpoint

The Milestone 2 software implementation and local CPU substitute tests are complete.
The original physical acceptance criterion (Laptop 2 executing a CUDA job over the
LAN) remains **NOT VERIFIED**. Development did not wait for Laptop 2, as authorized.
No GPU execution, physical LAN result or fabricated computation is claimed.

## Requirements verified in software

| Requirement | Implementation and evidence |
| --- | --- |
| Provider-specific worker authorization | Hashed credential binds one provider-owned slot; another slot's credential cannot start its job |
| Physical capability reporting | Worker detects capabilities before heartbeat; manual registration creates an offline slot; CUDA detection awaits hardware |
| Worker heartbeat and status | Periodic heartbeat, online freshness filter, one live session per slot |
| Greedy matching and concurrency | Existing matcher retained; conditional GPU reservation; two funded jobs competing for one slot yielded one ASSIGNED and one QUEUED |
| Leases and disconnect recovery | Job-specific lease required; expired lease refunds through actual backend cycle and releases reservation |
| Funding | Backend demo consumer signs register/deposit; receipt, contract state and event amount checked before QUEUED |
| Price | Exact decimal-string wei rate × integer minutes, computed with BigInt; displayed before funding |
| Execution and artifact | Real CPU matrix multiplication used locally; exact-byte SHA-256 and independent numerical verification required |
| Provider signature | Separate account #3 signs submitResult with Solidity bytes32 hash |
| Operator verification/payment | Separate account #1 verifies and releases; actual PaymentReleased event controls stored amount and COMPLETED |
| Retry and reconciliation | Backend raw signed transaction journal, receipt/event recovery, idempotent settlement and same-job worker retries |
| Safe failure | RPC regression leaves SETTLEMENT_PENDING; invalid bytes, wrong numerical result and stale workers cannot complete |
| Refund | Queued incompatible requests and intentional worker failure produced real RefundIssued receipts |
| Chain reset | Persisted Hardhat instance identity rejects old funding; stale jobs lose current COMPLETED/payment display while historical receipts remain |

## Changes in this checkpoint

- An interrupted assignment whose reservation lease expires now enters the refund
  path rather than remaining indefinitely queued.
- A job already assigned on-chain cannot be silently moved to another slot after
  losing its reservation; cancellation/refund is required.
- The periodic cycle invalidates stale-chain records, including previously completed
  ones, preserving historical receipts and clearing the current payment amount.
- Provider startup checks local chain identity and sufficient balance for a
  conservative 100,000-gas transaction budget at current fee settings.
- Payment reconciliation checks both the contract and event provider against the
  stored provider identity.

## Actual tests executed

- Backend: **89 passed**, including chain-reset display and RPC-failure regressions.
- Worker: **24 passed**.
- Contract: **37 passed**.
- Live CPU end-to-end integration: five successful jobs; an additional final-code
  smoke run is stored separately in `evidence/milestone2/final`.
- Live security/concurrency: **28 distinct checks passed**.
- Live lease recovery: expired dedicated test lease caused a real refund and GPU
  reservation release. Expiration was accelerated in MongoDB; it was not claimed
  as a full wall-clock disconnect-duration benchmark.
- Provider-wallet test: funded development wallet accepted; newly generated empty
  wallet rejected before startup. No private key is included in evidence.

New evidence is under `evidence/milestone2/`. Earlier evidence remains historical;
it is not relabeled as CUDA execution. Regression/failure tests using stubs are
clearly distinguished from live computation and actual local-chain receipts.

## Running the software

The local rehearsal uses the existing ignored `runtime/backend.env` and
`runtime/worker.env`, with `EXECUTION_MODE=real_cpu_test` and `FINAL_DEMO=false`.
Use [FINAL_DEMO_GUIDE.md](FINAL_DEMO_GUIDE.md) for exact startup commands and
[LAPTOP2_SETUP.md](LAPTOP2_SETUP.md) for the physical provider.

Additional verification commands, from the project root:

```powershell
node ops/check-provider-wallet.cjs
# Stop the normal worker before these isolated slot tests:
node ops/security-integration.cjs
node ops/lease-recovery.cjs
# Restart the normal worker, then:
$env:EVIDENCE_DIR = Join-Path (Get-Location) 'evidence/milestone2/repeated'
node ops/integration.cjs 5
```

Only a single backend process should send operator/consumer transactions. Exhaustive
crash injection at every persistence boundary is outside the executed evidence.
Hardware GPU compatibility, cross-laptop firewall/network operation and the final
physical Milestone 2 acceptance remain pending Laptop 2. No additional hardware
information is needed to use the locally tested software.
