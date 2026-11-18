# Laptop 2: CUDA provider

Physical GPU execution and cross-laptop networking have not been tested here.
Laptop 1 has Intel UHD 620 and cannot replace a missing NVIDIA CUDA provider.

Install Node >=20.19 and Python supported by the selected PyTorch CUDA build.
Use the official [PyTorch installation selector](https://pytorch.org/get-started/locally/)
for the actual Windows/Linux, Python and NVIDIA-driver combination. Do not infer
PyTorch compatibility from nvidia-smi's CUDA banner alone.

Copy the project source without private `.env` or `runtime` files. In PowerShell:

```powershell
python -m venv worker/.venv
worker/.venv/Scripts/python.exe -m pip install -r worker/requirements-compute.txt
# Run the CUDA PyTorch installation command selected from the official page
# using worker/.venv/Scripts/python.exe -m pip instead of pip.
npm.cmd ci --prefix worker
nvidia-smi --query-gpu=name,memory.total,driver_version --format=csv
worker/.venv/Scripts/python.exe worker/preflight.py --backend-url http://192.168.0.122:5000 --output laptop2-preflight.json
```

Run with both laptops on a trusted private LAN; replace 192.168.0.122 with Laptop
1's current IPv4 address. Preflight records PyTorch CUDA build, compiled GPU
architectures, physical device compute capability and exact known-answer CUDA output.

## Wallet and worker credential

Use Hardhat account #3 as provider, #2 as backend demo consumer, #1 as operator and
#0 as deployer. Hardhat prints development keys on startup. Copy only provider #3's
private key to Laptop 2's ignored `worker/.env`. It already has local test ETH for
gas on the default chain. Never use these public development accounts with real ETH.

In the provider dashboard, open the slot seeded by `node ops/provision.cjs`
(or register a slot if none exists), enter account #3's address, and
create a credential. Save its one-time displayed key locally:

```powershell
Copy-Item worker/.env.laptop2.example worker/.env
notepad worker/.env
```

Set BACKEND_URL and BLOCKCHAIN_RPC_URL to Laptop 1's LAN address, WORKER_API_KEY to
the issued credential, PROVIDER_PRIVATE_KEY to account #3. Keep EXECUTION_MODE=real_gpu
and FINAL_DEMO=true. On Laptop 1 run `node ops/setup-local.cjs real_gpu`, restart
backend, and do not run the local CPU worker. Configure a separate slot/credential
for each physical GPU worker. Keys bind a provider to a GPU slot, not to all jobs.

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File ops/start-worker.ps1 -EnvFile worker/.env -Python worker/.venv/Scripts/python.exe
```

If the relative Python path fails after changing working directories, supply its
absolute path. The GPU must be detected before the worker sends heartbeats. Missing
CUDA, unsupported kernels and out-of-memory errors do not fall back to CPU.

## Network and firewall

On Laptop 1 start Hardhat bound to its LAN interface for provider signing:

```powershell
cd blockchain
npm.cmd run node -- --hostname 0.0.0.0
```

Redeploy if this restarts the chain. Verify the trusted network's Private profile.
In Administrator PowerShell on Laptop 1:

```powershell
$peerIp = Read-Host 'Laptop 2 IPv4'
New-NetFirewallRule -DisplayName 'BDGCE trusted provider' -Direction Inbound -Action Allow -Protocol TCP -LocalPort 5000,5173,8545 -RemoteAddress $peerIp -Profile Private
```

Do not expose development RPC publicly or forward it through the router. MongoDB
27017 and IPFS APIs need no remote access. From Laptop 2:

```powershell
Test-NetConnection 192.168.0.122 -Port 5000
Test-NetConnection 192.168.0.122 -Port 8545
Invoke-RestMethod http://192.168.0.122:5000/health | ConvertTo-Json -Depth 6
```

Open provider dashboard at http://192.168.0.122:5173. If ports fail, check address,
adapter profile, hotspot client isolation and firewall scope. Remove the rule when
finished with `Remove-NetFirewallRule -DisplayName 'BDGCE trusted provider'`.

### Switching from the local rehearsal to the two-machine demo

After saving rehearsal evidence, stop its worker, frontend, backend and Hardhat
terminals. Leave MongoDB running. Apply the private peer firewall rule above.
Use separate Laptop 1 PowerShell terminals starting at the repository root:

1. Run `cd blockchain` and `npm.cmd run node -- --hostname 0.0.0.0`. A fresh local chain starts.
2. In a second terminal, run the following in order:

```powershell
cd blockchain
npm.cmd run deploy:local
cd ..
node ops/setup-local.cjs real_gpu
powershell.exe -NoProfile -ExecutionPolicy Bypass -File ops/start-backend.ps1
```

3. In a third terminal, confirm `real_gpu`, a connected database and an available
   blockchain, provision accounts, and start the LAN frontend:

```powershell
Invoke-RestMethod http://127.0.0.1:5000/health | ConvertTo-Json -Depth 6
node ops/provision.cjs
cd frontend
npm.cmd run dev -- --host 0.0.0.0 --port 5173 --strictPort
```

4. On Laptop 2 run preflight against Laptop 1's current LAN IPv4, open the
   provider dashboard, configure its issued slot credential and local signing key,
   and run the worker startup command above. Use separate consumer and provider
   browser sessions for the demonstration. Preserve the preflight JSON and the
   worker timing files for the final report.

## Actual GPU benchmarks, later

Use AC power and stable performance settings. Run:

```powershell
worker/.venv/Scripts/python.exe worker/benchmark.py --mode real_gpu --sizes 128 256 512 --runs 10 --output evidence/gpu-benchmark
```

Install matplotlib to generate the optional chart. The script records every raw
sample, CPU float32 comparison, CUDA warmup, separate synchronized transfers/kernel,
memory, environment, Git commit, median/min/max and CSV. Collect at least five full
GPU end-to-end runs separately. Supported utilization telemetry and clock/driver
settings should be captured on the physical machine. Never reuse CPU timings as GPU
results or subtract timestamps between unsynchronized laptops.

PERFORMANCE_RESULTS.md includes the exact five-job collector and reporting commands.
Copy the matching timing JSON files from the worker results folder to Laptop 1
for the joined report. The worker takes a host OS lock for its selected CUDA
device while serving jobs. Stop it before running isolated compute benchmarks.

Worker startup now checks provider test-ETH balance against a 100,000-gas budget at current RPC fees. An unfunded wallet fails before heartbeats; use the default funded local Hardhat provider account or fund it with local test ETH.
