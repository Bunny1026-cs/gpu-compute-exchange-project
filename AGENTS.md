# Repository Guidelines

## Project Structure & Module Organization
- `frontend/src/`: React UI and API services; assets in `src/assets/` and `public/`.
- `backend/`: Express API, Mongoose models, and scheduler; tests in `backend/test/`.
- `blockchain/`: Solidity contracts, deployment scripts, and Hardhat tests in `contracts/`, `scripts/`, and `test/`.
- `worker/`: Python polling, simulated execution, result handling, and `tests/`.
- `docker-compose.yml`: local service orchestration. Root `scripts/` holds Git-ignored research utilities.

## Build, Test, and Development Commands
Use Node.js >=20.19 and Python >=3.10. Run `npm install` separately in `frontend/`, `backend/`, and `blockchain/`; run `pip install -r requirements.txt` in `worker/`.

Commands by directory:

| Directory | Command | Purpose |
| --- | --- | --- |
| `frontend/` | `npm run dev` | Start Vite locally |
| `frontend/` | `npm run build` / `npm run lint` | Build production assets / run Oxlint |
| `backend/` | `npm run dev` | Start API (nodemon) |
| `backend/` | `npm test` | Run Node test suites |
| `blockchain/` | `npm run compile` / `npm test` | Compile contracts / run Hardhat tests |
| `blockchain/` | `npm run node` | Start local chain; run `npm run deploy:local` separately |
| `worker/` | `python runner.py` | Start polling worker |
| `worker/` | `python -m unittest discover -s tests -v` | Run worker tests |
| Root | `docker compose up --build` | Start local stack |

## Coding Style & Naming Conventions
Use two-space JavaScript/JSX indentation, double quotes, and semicolons; four-space Python indentation. Use CommonJS in the backend and ES modules in the frontend. Use PascalCase components/models, camelCase JavaScript functions, and snake_case Python functions. Frontend linting uses Oxlint.

## Testing Guidelines
Use `node:test` with strict assertions, Hardhat's Mocha/Chai tests, and Python `unittest`. Name JavaScript tests `*.test.js` and Python tests `test_*.py`. Add regression tests for changed behavior; register new backend suites in its explicit `npm test` list. Backend tests stub MongoDB. No coverage threshold is configured.

## Commit & Pull Request Guidelines
Git history is unavailable in this checkout. Use scoped imperative subjects, e.g. `fix(scheduler): reject invalid CUDA requirements`. PRs should explain changes, link issues, list checks, and include UI screenshots.

## Security & Configuration
Copy component `.env.example` files to `.env`; never commit secrets. Match backend/worker API keys. This is a local prototype: execution is simulated and IPFS defaults to a mock. Use Hardhat keys only locally and keep secrets out of frontend `VITE_*` variables.
