# BDGCE startup and demonstration

The software supports an explicit `real_cpu_test` development run and `real_gpu`
CUDA demonstration. Physical two-laptop and CUDA acceptance remain NOT VERIFIED.
All payments are local Hardhat test ETH. Use native Python; the historical
all-services Compose recipe is not the supported real-compute demonstration.

## Installation

Use Node >=20.19, Python >=3.10 with a compatible PyTorch wheel, and MongoDB 7.
Run these from the project root in PowerShell:

```powershell
npm.cmd ci --prefix backend
npm.cmd ci --prefix blockchain
npm.cmd ci --prefix frontend
npm.cmd ci --prefix worker
python -m pip install -r worker/requirements-compute.txt
# Laptop 1 CPU development / independent backend verification:
python -m pip install torch --index-url https://download.pytorch.org/whl/cpu
```

For GPU installation use [LAPTOP2_SETUP.md](LAPTOP2_SETUP.md). Keep Python and
NumPy/PyTorch versions recorded on both laptops. Never copy private runtime files
to a public repository. Provisioning generates random demo login passwords in
ignored `runtime/accounts.json`.

## Startup order (separate terminals)

1. Start MongoDB. Existing MongoDB on localhost:27017 is sufficient. Alternatively:

```powershell
docker.exe run -d --name bdgce-mongo -p 127.0.0.1:27017:27017 -v bdgce-mongo-data:/data/db mongo:7
# On subsequent starts: docker.exe start bdgce-mongo
```

2. Prepare ignored configuration and start the local chain:

```powershell
node ops/setup-local.cjs real_cpu_test
cd blockchain
npm.cmd run node -- --hostname 127.0.0.1
```

3. In another root terminal, deploy and regenerate configuration:

```powershell
cd blockchain
npm.cmd run deploy:local
cd ..
node ops/setup-local.cjs real_cpu_test
```

4. Start backend (PowerShell scripts can be invoked with a process-only policy):

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File ops/start-backend.ps1
```

5. Wait for connected database and blockchain in `/health`, then provision:

```powershell
Invoke-RestMethod http://127.0.0.1:5000/health | ConvertTo-Json -Depth 6
node ops/provision.cjs
Get-Content runtime/accounts.json
```

6. Start CPU development worker:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File ops/start-worker.ps1 -EnvFile runtime/worker.env
```

7. Start frontend:

```powershell
cd frontend
npm.cmd run dev -- --port 5173
```

Open http://localhost:5173. The Vite proxy uses relative `/api` routes so Laptop 2
can use `http://LAPTOP1-IP:5173` without calling its own localhost. The same native
startup works for CUDA after running `node ops/setup-local.cjs real_gpu` and
restarting backend, using a GPU worker on Laptop 2 instead of the local CPU worker.
Do not run `ops/provision.cjs` while a slot is busy; it rotates credentials.

## Eight-step demonstration (10–15 minutes)

1. Show both private LAN addresses and Laptop 2 preflight JSON. For a CPU rehearsal,
   explicitly state that physical GPU execution is pending.
2. Log in as provider, show worker online, detected GPU, mode, and heartbeat.
3. Log in as consumer in another browser/profile. Select matrix size, seed and
   requirements; submit. Initial state is AWAITING_FUNDING.
4. Read rate × reserved minutes and total wei; click **Fund with Demo Wallet**.
5. Show QUEUED, ASSIGNED and RUNNING states. No GPU assignment precedes funding.
6. Show worker's computed metadata and real `.npy` artifact; download it.
7. Show independent numerical verification, exact-byte SHA-256 and provider's
   ResultSubmitted receipt. Hash consistency alone does not prove GPU provenance.
8. Show PaymentReleased event amount, receipt hash, gas, COMPLETED status and
   released GPU reservation. All blockchain measurements are local development.

Tested failure scenario: submit a job requiring more GPU memory than available,
fund it, then cancel; demonstrate a confirmed refund and REFUNDED status.

## Recovery and reset

Transient RPC failures leave settlement/refund pending; retry from the job panel.
The periodic backend cycle also reconciles accepted results and refunds. Failed or
expired workers cannot submit a result with an obsolete lease. Restarting a worker
can recover its existing job; a live duplicate worker session is rejected.

For a clean test reset, stop backend and worker with Ctrl+C, then stop and restart
Hardhat. This deliberately discards local test chain state. Run:

```powershell
node ops/reset-demo.cjs --chain-restarted
cd blockchain
npm.cmd run deploy:local
cd ..
node ops/setup-local.cjs real_cpu_test
```

Restart backend, provision accounts, then start worker/frontend. Reset is restricted
to `bdgce_real_demo`; artifacts are retained in timestamped backup folders. Do not
reset MongoDB while keeping a funded chain and expecting it to refund automatically.
Existing jobs from another chain instance fail closed. Preserve evidence before reset.

## Verification commands

```powershell
npm.cmd test --prefix backend
npm.cmd test --prefix blockchain
npm.cmd run build --prefix frontend
npm.cmd run lint --prefix frontend
cd worker
python -m unittest discover -s tests -v
cd ..
node ops/integration.cjs 5
# Stop normal worker first for isolated security tests:
node ops/security-integration.cjs
```

Use an isolated demo database for destructive failure/reset exercises. Test evidence
and unverified limits are recorded in TEST_RESULTS.md and PERFORMANCE_RESULTS.md.
