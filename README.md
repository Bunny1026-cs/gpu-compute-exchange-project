# GPU Compute Exchange

A decentralized GPU compute marketplace connecting GPU providers with consumers who need ML/AI compute power.

---

## Architecture Overview

Target architecture (see "Implementation status" below for what is actually
implemented; GPU containers and public-chain operation are planned, not built):

```
Consumer → Backend → Database → Job Queue → Scheduler → GPU Worker → Docker → GPU Execution → Result → IPFS
                 ↓
           Smart Contract → Blockchain → Escrow/Payment
```

## Monorepo Structure

```
gpu-compute-exchange/
├── frontend/          # React UI (Vite)
├── backend/           # Node.js + Express API
├── blockchain/        # Hardhat — Solidity smart contracts
│   ├── contracts/     # Solidity source files
│   ├── scripts/       # Deployment scripts
│   └── test/          # Contract tests
├── worker/            # Python GPU executor
│   ├── executor/      # Job execution logic
│   └── job-runner/    # Job polling & lifecycle management
├── docker-compose.yml # Full-stack local orchestration
└── README.md
```

## Tech Stack

| Layer | Technology (as implemented) |
|---|---|
| Frontend | React 19 + Vite, React Router, Fetch API |
| Backend API | Node.js + Express, Mongoose, JWT, ethers.js v6 |
| Database | MongoDB |
| Smart Contract | Solidity 0.8.24 (Hardhat), local Hardhat network only |
| Worker | Python REST-polling worker — **simulated** execution |
| Result Storage | IPFS service with a local mock store (default) |

## Getting Started

### Prerequisites
- Node.js >= 20.19 (22 LTS recommended; required by Mongoose 9 and Vite 8)
- Python >= 3.10
- Docker & Docker Compose (for the full-stack setup)

No browser wallet is used: the prototype has no MetaMask or client-side
transaction signing.

### Install Dependencies

```bash
cd frontend && npm install
cd backend && npm install
cd blockchain && npm install
cd worker && pip install -r requirements.txt
```

### Run Locally

```bash
# Blockchain: local node + contract deployment (optional)
cd blockchain && npm run start:local

# Backend (copy .env.example to .env first)
cd backend && npm start

# Frontend
cd frontend && npm run dev

# Worker
cd worker && python runner.py
```

### Docker (full stack)

```bash
docker compose up --build
```

This starts MongoDB, a Hardhat development chain with the escrow contract
deployed, the API, the worker, and the frontend. The backend waits until the
contract bytecode exists on the chain (`hardhat-node` health check) before it
starts, because blockchain initialisation runs once at startup. It uses
development-only defaults for the JWT secret, worker key, and Hardhat test
accounts. Override them in a root `.env` before using this outside a local
demo.

The development-only `/api/dev/*` routes (scheduler trigger, demo escrow)
are disabled unless `ENABLE_DEV_ROUTES=true` is set (for example in a root
`.env`), and are never mounted when `NODE_ENV=production`. Job-mutating demo
routes accept only the consumer who owns the job.

The local Hardhat contract is deployed at
`0x5FbDB2315678afecb367f032d93F642f64180aa3` whenever the chain starts from
an empty state. All cryptocurrency values in this mode are test ETH only.
Restarting the chain container resets the chain; MongoDB job records are not
reset with it.

### Tests

```bash
cd backend && npm test             # node:test suites (no MongoDB needed)
cd blockchain && npx hardhat test  # contract tests
cd worker && python -m unittest discover -s tests -v
cd frontend && npm run build && npm run lint

# Optional, needs a running local chain (blockchain: npm run start:local)
cd backend && npm run check:chain
```

---

## Implementation status and integration boundary

This is a local-development research prototype, not a production system.

**Implemented and tested**
- Registration/login with JWT; consumer and provider roles.
- Provider GPU registration (model, memory, CUDA version, hourly price,
  availability). BUSY is set only by the scheduler/worker lifecycle.
- Job submission with optional memory / minimum-CUDA / maximum-hourly-price
  requirements; malformed requirements are rejected.
- Scheduler: FIFO by creation time with first-fit skipping; selects the
  lowest-priced compatible GPU (tie-break: smallest sufficient memory).
  GPU and job claims are conditional database updates; cycles do not
  overlap within one backend process.
- Worker lifecycle (start, result, complete, fail) with conditional
  transitions, so duplicate requests cannot both succeed.
- Escrow contract: registration, deposit, assignment, result-hash
  submission, verification, payment release, operator refunds, and role
  separation (provider ≠ operator, provider ≠ consumer).

**Simulated or mocked**
- GPU execution: the worker generates simulated, deterministic results
  (same job → same result hash). No GPU code or container is run.
- IPFS: a local mock store is used unless `IPFS_API_URL` is configured;
  the real-IPFS path is untested.

**Integration boundary of the blockchain escrow**
- The contract is verified in isolation by its Hardhat test suite.
- In the running system, only these steps reach the chain:
  - `registerJob` + `depositFunds` — via the development demo-escrow route
    only (demo consumer key, test ETH); the UI never calls it;
  - `assignJob` — by the scheduler, when the chain is available and the
    provider has a wallet address.
- `submitResult` must be signed by the provider's wallet, which the backend
  does not hold, and the worker does not submit on-chain results. Therefore
  `verifyResult` / `releasePayment` cannot succeed in the integrated flow;
  job completion and failure proceed in MongoDB, and the on-chain attempt
  only logs a warning. The dev `submit-result` route returns 501.
- The backend operator is trusted for assignment, verification, payment
  release, and refunds. There is no deadline-based refund or dispute path.
  A matching hash records a submitted result; it does not prove that a
  computation was performed correctly.

**Not implemented**
Real GPU/container execution, provider or consumer wallets, public-network
deployment, verifiable computation, per-provider worker credentials (one
shared worker API key is used), stale-job recovery, and production secret
management.

---

## Users

### Consumer
- Register/Login
- Browse available GPUs
- Submit jobs with hardware and price requirements
- Track job status
- Retrieve result data (mock IPFS by default)

### Provider
- Register/Login
- Register GPU (model, VRAM, CUDA version)
- Set price & availability (not while a job holds the GPU)
- See jobs assigned to their GPUs (executed by the simulated worker)

---

> ⚠️ GPU computation is handled **off-chain** by the Python worker. The blockchain is used **only** for trust, payment, and escrow logic.
