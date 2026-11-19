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
python -m venv --system-site-packages runtime/provider-venv
runtime/provider-venv/Scripts/Activate.ps1
python -m pip install -r worker/requirements-compute.txt
# Laptop 1 CPU development / independent backend verification:
python -m pip install torch --index-url https://download.pytorch.org/whl/cpu
```

Activate the same environment in each new worker terminal, or use
`runtime/provider-venv/Scripts/python.exe` in place of `python`.
The environment can reuse the host PyTorch build while installing the worker's HTTP dependencies locally.

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

## Self-service batch pilot

Start MongoDB, Hardhat, the API and Vite with steps 1–5 and 7 above. Step 6 starts the separate matrix worker and is optional for the batch pilot. Use Docker Desktop in Linux-container mode on the provider machine. From the repository root in PowerShell, pull the exact runtime and inspect the detected device inventory:

```powershell
$profiles = Get-Content worker/profiles.json -Raw | ConvertFrom-Json
docker pull $profiles.'python-cpu'
$env:WORKER_ENV_FILE = (Resolve-Path runtime/worker.env).Path
python worker/agent.py --discover --cpu-dev
```

Sign in as the provider and choose **Pair local agent**. In the same PowerShell terminal, enter the displayed code within five minutes:

```powershell
$code = Read-Host 'Single-use pairing code'
python worker/agent.py --cpu-dev --pair $code
```

For later starts use `python worker/agent.py --cpu-dev`. The ignored `runtime/paired-agent.json` holds the agent credential. Pairing creates disabled devices. Enable the **CPU development slot** and set a positive integer rate in wei/min. **Stop accepting jobs** stops new reservations while an assigned job completes. Restart the agent to rediscover changed hardware. The API, RPC, provider wallet and explicit CPU-mode setting come from the worker environment file.

In a second browser profile, sign in as the consumer. Choose the Python script workload and upload a trusted `.py` file or paste this script. Select the Python CPU profile, set arguments to `["21"]`, a 25-second limit and expected output `result.txt`.

```python
import sys
print("Writing result", flush=True)
with open("result.txt", "w") as output:
    output.write(str(2 * int(sys.argv[1])))
```

1. Select **Save and quote**. The quote is the selected rate times the runtime rounded up to whole minutes. A missing compatible device saves a draft. **Refresh quote** checks again.
2. Fund the quote with demo test ETH. The scheduler reserves a slot with a rate within the quote. The agent probes the runtime before on-chain assignment. The escrow payout remains the fixed funded amount.
3. Watch the job and log tail. Download `result.txt` in REVIEW and confirm its contents are `42`. **Accept and pay** releases the escrow. Inspect the provider signature and payment receipts in the job.
4. Select **Run again** for a new job with identical inputs and a fresh quote. To demonstrate a timeout, submit `import time; time.sleep(45)` with a two-second limit. Verify REFUNDED, a RefundIssued receipt and the available slot.
5. To exercise review, choose **Report issue** and enter a reason. Reviews expire after 24 hours. On Laptop 1 an operator with access to the backend configuration can inspect and resolve them:

```powershell
node ops/resolve-review.cjs list
$job = Read-Host 'Disputed or expired job ID'
node ops/resolve-review.cjs $job refund "Output failed the agreed acceptance check"
# To pay instead: node ops/resolve-review.cjs $job accept "Output accepted after review"
```

The runtime permits 1–600 seconds, 48 KiB of source, up to eight flat output filenames and 2 MiB of returned bytes combined. Use the current directory for outputs. The container runs as UID 65534 with one CPU, 1 GiB of host memory, a 64-process limit, a read-only root and input, bounded temporary filesystems and networking disabled. Package dependencies must be present in the pinned image. The agent keeps signing credentials on the host. Batch verification checks bytes and file digests. Consumers determine whether a script produced the intended result.

### Reproduce automated batch checks

Use a dedicated local demo database and local Hardhat chain. Install the browser tools using the commands at the end of this guide. With the paired CPU agent running, run the following at the root. The browser test sets the pilot device rate and leaves a disputed repeat job for the operator exercise. The scheduling test enrolls two explicitly synthetic devices, exercises contention and failed readiness with real local escrow, and retires its fixture slots.

```powershell
$env:NODE_PATH = (Resolve-Path runtime/browser-tools/node_modules).Path
$env:EVIDENCE_DIR = Join-Path $PWD 'runtime/batch-evidence'
node ops/batch-rehearsal.cjs
$job = (Get-Content "$env:EVIDENCE_DIR/batch-pilot.json" -Raw | ConvertFrom-Json).disputeJob
node ops/resolve-review.cjs $job refund "Rehearsal dispute resolved"
node ops/check-settlement.cjs "$env:EVIDENCE_DIR/batch-pilot.json"
node ops/batch-reservation-check.cjs
npm.cmd test --prefix backend
npm.cmd test --prefix blockchain
Push-Location worker
python -m unittest discover -s tests -v
Pop-Location
npm.cmd run build --prefix frontend
npm.cmd run lint --prefix frontend
```

### Laptop 2 batch CUDA

Follow the private-LAN and wallet setup in `LAPTOP2_SETUP.md`. Start Docker with NVIDIA GPU passthrough. Configure Laptop 1 API and RPC addresses in the ignored worker environment and use a provider-only local Hardhat wallet with gas. The batch agent uses pairing in place of the native matrix worker key. From Laptop 2:

```powershell
$profiles = Get-Content worker/profiles.json -Raw | ConvertFrom-Json
docker pull $profiles.'pytorch-cuda'
nvidia-smi
$env:WORKER_ENV_FILE = (Resolve-Path worker/.env).Path
python worker/agent.py --discover
$code = Read-Host 'Pairing code from provider dashboard'
python worker/agent.py --pair $code
```

Start subsequent sessions with `python worker/agent.py`. Enable each desired GPU. The agent selects by NVIDIA UUID and must complete a CUDA dot product in the pinned image on that device. On the consumer dashboard choose the CUDA profile, set minimum VRAM and choose **Load training template**. Download `metrics.json` and `checkpoint.pt` before accepting. Physical CUDA, passthrough and two-laptop results must be recorded on the target hardware.

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

The reset command checks the running Hardhat instance against the recorded deployment,
jobs and journal before dropping the dedicated database. It archives results on the
machine where it runs. On Laptop 2, stop the worker and archive its output separately
before a new demonstration. Preserve Kubo pins as copies of historical evidence.

```powershell
if (Test-Path worker/results) {
  Rename-Item -LiteralPath worker/results -NewName ("results.reset-" + (Get-Date -Format yyyyMMdd-HHmmss))
}
```

For the storage walkthrough, start a locally configured Kubo daemon on Laptop 1
before uploading a job. Use its loopback RPC API (default port 5001). Check the
CID and storage label after completion. With Kubo stopped, a new job should show
local file storage and offer the authenticated NumPy download.

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

For a repeatable CPU browser rehearsal, keep the normal worker running, then use
the commands below from the project root. The script creates two test accounts
and one temporary provider slot, submits a paid job and a refunded job, checks
the NumPy download against its digest, and saves the two dashboard screenshots.

```powershell
npm.cmd install --prefix runtime/browser-tools playwright-core@1.61.1
node runtime/browser-tools/node_modules/playwright-core/cli.js install chromium
$env:NODE_PATH = (Resolve-Path runtime/browser-tools/node_modules).Path
$env:EVIDENCE_DIR = Join-Path $PWD ("evidence/browser-" + (Get-Date -Format yyyyMMdd-HHmmss))
node ops/browser-rehearsal.cjs
```

After an application collector run, check the storage outcome with
`node ops/check-artifact-storage.cjs PATH-TO-INTEGRATION-JSON ipfs_and_local_file`
or use `local_file` for a batch submitted while Kubo was offline.
Before restarting Hardhat, run `node ops/check-settlement.cjs PATH-TO-INTEGRATION-JSON`
to independently check all six receipt senders and events against the MongoDB
records and live escrow. Set MONGODB_URI if the backend uses a separate rehearsal database.
