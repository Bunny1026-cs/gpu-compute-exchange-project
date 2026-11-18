# Blockchain-Enabled Distributed GPU Compute Exchange

BDGCE is a local engineering demonstration of a React/Express/MongoDB marketplace,
Python/PyTorch matrix worker, greedy scheduler and Solidity Hardhat escrow.

Start with [FINAL_DEMO_GUIDE.md](FINAL_DEMO_GUIDE.md) for installation, exact startup
commands, generated demo accounts, browser workflow, recovery and safe reset.
[LAPTOP2_SETUP.md](LAPTOP2_SETUP.md) covers CUDA, provider wallets, private LAN and
firewall configuration. [TEST_RESULTS.md](TEST_RESULTS.md) records executed checks;
[PERFORMANCE_RESULTS.md](PERFORMANCE_RESULTS.md) contains actual measurements and
[VIVA_QA.md](VIVA_QA.md) explains the design and limitations.

## Execution modes

- `real_gpu`: requires working physical NVIDIA CUDA execution; no fallback.
- `real_cpu_test`: genuine CPU development computation, permitted only with
  FINAL_DEMO=false. Its timings and results are never labeled GPU evidence.

The native server entry point defaults to real_gpu. Setup generates ignored files:

```powershell
node ops/setup-local.cjs real_cpu_test
```

Follow the guide to start MongoDB, Hardhat, deploy the unchanged escrow, start the
backend, provision accounts, and start worker/frontend in separate terminals.
To prepare a physical demonstration use `node ops/setup-local.cjs real_gpu` and a
Laptop 2 worker configured from `worker/.env.laptop2.example`.

## Workflow and integrity

The consumer submits an immutable matrix specification, reviews the quote and funds escrow.
The scheduler reserves a matching worker. After execution, the backend verifies the uploaded
bytes and numerical output. The provider signs submitResult, the operator verifies and releases
payment, and both dashboards show the confirmed receipt and event amount.

Jobs use AWAITING_FUNDING, QUEUED, ASSIGNED, RUNNING, RESULT_UPLOADED,
SETTLEMENT_PENDING, COMPLETED, REFUND_PENDING, REFUNDED, FAILED and CANCELLED states.
CPU inputs are seeded PCG64 float32 arrays; outputs are safe NumPy arrays without
pickle. SHA-256 is over exact bytes. The backend regenerates a float64 CPU reference
and checks rtol/atol 1e-4. Only bounded matrix multiplication is allowed.

Provider credentials bind one account and slot; detected capabilities and heartbeats
control scheduling. Conditional reservations, worker sessions and job leases reject
concurrent/stale work. Backend transactions are signed and journaled before broadcast;
retries reconcile receipts and events. Wei amounts are decimal strings/BigInt.
Hardhat instance IDs prevent reuse of funding from a reset chain.

## Scope and honest verification

The backend stores each verified artifact locally and attempts to pin the same bytes to
Kubo through its API on Laptop 1 (default `http://127.0.0.1:5001`). A CID is recorded
only after binary read-back matches. Downloads check SHA-256 and can use the local copy.
Set `IPFS_API_URL=` in the backend runtime environment for local-file-only operation. Legacy IPFS and
simulated executor modules remain for preserved regression tests and are not invoked
by the supported real worker/server workflow. The historical Docker Compose all-stack
recipe is not the supported real-compute demo; native startup is documented instead.
No IEEE paper was changed. No GPU, physical LAN or public-chain benchmark is claimed.
Use a trusted LAN and local test ETH only; this prototype does not attest remote GPU
hardware or provide production wallet custody. Run one backend instance for serialized
wallet transactions. CPU tests demonstrate software behavior, not GPU performance.

## Tests

```powershell
npm.cmd test --prefix backend
npm.cmd test --prefix blockchain
npm.cmd run build --prefix frontend
npm.cmd run lint --prefix frontend
cd worker
python -m unittest discover -s tests -v
```

Live integration commands and their required service order are in the demo guide.
