# GPU Compute Exchange

A decentralized GPU compute marketplace connecting GPU providers with consumers who need ML/AI compute power.

---

## Architecture Overview

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

| Layer | Technology |
|---|---|
| Frontend | React (Vite) |
| Backend API | Node.js + Express |
| Database | PostgreSQL / MongoDB |
| Smart Contracts | Solidity (Hardhat) |
| Blockchain | Ethereum / EVM-compatible |
| GPU Execution | Python + Docker |
| Result Storage | IPFS |

## Getting Started

### Prerequisites
- Node.js >= 20 (the frontend build uses Vite 8)
- Python >= 3.10
- Docker & Docker Compose
- MetaMask or compatible wallet

### Install Dependencies

```bash
# Frontend
cd frontend && npm install

# Backend
cd backend && npm install

# Blockchain
cd blockchain && npm install
```

### Run Locally

```bash
# Backend
cd backend && npm start

# Frontend
cd frontend && npm run dev

# Blockchain (local node)
cd blockchain && npx hardhat node
```

### Docker (full stack)

```bash
docker compose up --build
```

This starts a local MongoDB instance, a Hardhat development chain with the
escrow contract deployed, the API, the worker, and the frontend. It uses
development-only defaults for the JWT secret, worker key, and Hardhat test
accounts. Override them in a root `.env` before using this outside a local
demo.

The local Hardhat contract is deployed at
`0x5FbDB2315678afecb367f032d93f642f64180aa3` whenever the chain starts from
an empty state. All cryptocurrency values in this mode are test ETH only.

---

## Current scope

This is a local-development demo. It includes authentication, GPU/job
scheduling, a simulated worker, mock-IPFS fallback, and a Hardhat escrow
contract. It is not production-ready: real GPU containers, provider wallet
management, production-grade secret storage, and live-network payments still
need implementation and security review.

---

## Users

### Consumer
- Register/Login
- Browse available GPUs
- Submit ML jobs
- Pay via escrow smart contract
- Track job status
- Retrieve results from IPFS

### Provider
- Register/Login
- Register GPU (model, VRAM, CUDA version)
- Set price & availability
- Execute assigned jobs via Docker
- Receive payment upon job completion

---

> ⚠️ GPU computation is handled **off-chain** by the Python worker. The blockchain is used **only** for trust, payment, and escrow logic.
