# Milestone 1: hardware and LAN checkpoint

Status: **INCOMPLETE — awaiting Laptop 2 hardware evidence.** No Milestone 2 work.
PROJECT_PLAN.md requires hardware capability to be established before implementing
the initial workload. Only the fixed 2x2 CUDA diagnostic is implemented so far;
the parameterized workload, timed transfers, warm measurements, and `.npy` output
remain pending. Existing simulated execution is not suitable for the final demo.
Setting EXECUTION_MODE=real_gpu does not yet turn the existing runner into a real
GPU worker. Do not use runner.py as evidence of real GPU execution.

## Repository checkpoint and inspection

- Base commit: `4db942133316e4832e7d074df37d8caf437085cc`.
- Branch: `milestone1/hardware-preflight-20261117`.
- Before editing, the only tracked modification was an accidental `chec` prefix
  in worker/config.py. Original bytes and a Git patch were saved in
  `.local-checkpoints/milestone1-20261117/` before removing that syntax error.
  The corrected file matches HEAD. Existing untracked files were retained.
- Inspected Express entry point/routes, scheduler atomic claims and rollback,
  worker polling/executor/result lifecycle, frontend API configuration,
  blockchain role/nonce handling, contract, Compose, and package/test scripts.
- Existing worker execution is simulated. Frontend fallback/Compose API URL uses
  localhost. Provider-signed submission and full lifecycle changes belong to later
  milestones and were not implemented here. The health response's existing
  `phase: Complete — Full Pipeline` label is not evidence of project completion.

## Laptop 1 observations

| Check | Actual result |
| --- | --- |
| OS | Windows 11, build 26200, x64 |
| Node / npm | 22.21.0 / 11.6.2 |
| Python | 3.13.7 |
| Display adapter / driver | Intel UHD Graphics 620 / 31.0.101.2141 |
| PyTorch | 2.12.1+cpu; torch.version.cuda=None; CUDA unavailable; architectures=[] |
| NVIDIA utility | nvidia-smi not found on PATH |
| Python packages | requests 2.32.5; python-dotenv 1.2.2; numpy 2.3.4 |
| Backend packages | Express 4.22.2; Mongoose 9.9.3; ethers 6.17.0 |
| Frontend packages | React 19.2.8; Vite 8.2.1; Oxlint 1.78.0 |
| Hardhat | 2.29.0, installed; compiler and tests work |
| MongoDB | 7.0.48; actual localhost admin ping returned {ok:1} |
| Initial listeners | MongoDB 27017 present; backend 5000 and RPC 8545 absent |
| Wi-Fi IPv4 | 192.168.0.122 at inspection; recheck after network changes |
| Other adapters | Ethernet 192.168.100.1; WSL 172.22.96.1; not assumed to be Laptop 2's route |

A temporary instance of the existing Express app (without scheduler/DB startup)
was reachable through both 127.0.0.1:5000 and 192.168.0.122:5000 from Laptop 1.
Both returned the expected service identity; database disconnected and blockchain
unavailable were correctly retained in the report. This listener was temporary
and stopped. **Laptop 2 to Laptop 1 connectivity is NOT VERIFIED.**

The Intel adapter does not support the required NVIDIA CUDA execution. Swapping
roles will not solve a missing compatible GPU on Laptop 2 with current hardware.
If Laptop 2 also lacks one, stop: a compatible physical NVIDIA machine is needed.

## Tests actually executed

| Command / check | Result |
| --- | --- |
| backend: npm.cmd test | 82 passed, 0 failed |
| blockchain: npm.cmd test | Solidity compilation successful; 37 passed |
| frontend: npm.cmd run build | Passed |
| frontend: npm.cmd run lint | Passed |
| worker: python -m unittest discover -s tests -v (before edits) | 10 passed |
| worker: python -m unittest discover -s tests -v (after edits) | 17 passed, including 7 diagnostic tests |
| python -m py_compile worker/config.py worker/preflight.py | Passed |
| Laptop 1 preflight before temporary HTTP listener | CUDA failed as expected; backend connection refused |
| Temporary backend HTTP checks on loopback and Wi-Fi IP | Both passed locally; not a two-laptop test |
| MongoDB ping and buildInfo | Passed; 7.0.48 |

New tests cover CUDA timeout/crash/malformed output/CPU-only failure, invalid URLs,
unrelated HTTP services, and reachability without claiming DB readiness. They use
mocks and do not count as CUDA hardware evidence. Existing worker tests validate
the simulated executor only. No GPU performance or real workload result is claimed.

Initial diagnostic attempts encountered PowerShell's npm.ps1 execution restriction
(resolved using npm.cmd), sandbox denial of hardware/network inventory and Git
branch writes (rerun with approval), and a Node inline-command quoting error
(MongoDB check then succeeded using stdin). No execution policy was changed.
An npm inventory at the repository root inspected the parent package rather than
this monorepo; inventories were then run successfully in all three component folders.

## Exact Laptop 1 setup for the LAN check

Connect both laptops to the same trusted private Wi-Fi/hotspot. From the project
root in PowerShell, recheck the address:

```powershell
Get-NetIPAddress -AddressFamily IPv4 | Format-Table InterfaceAlias,IPAddress
```

For this checkpoint, start the existing Express app without running the scheduler
or processing existing jobs. Keep this terminal open; Ctrl+C stops it:

```powershell
cd backend
$env:ENABLE_DEV_ROUTES = 'false'
node -e "require('./app').listen(5000, '0.0.0.0')"
```

This is an HTTP connectivity check only; database disconnected and blockchain
unavailable in /health are expected for this startup. Full normal startup uses
`npm.cmd start` in backend with its ignored .env configured, but is unnecessary
for this hardware checkpoint. Do not start the simulated worker.

If Windows Firewall blocks Laptop 2, confirm the trusted adapter uses the Private
profile (`Get-NetConnectionProfile`). On Laptop 1 in Administrator PowerShell,
enter Laptop 2's actual Wi-Fi IPv4 when prompted and permit only that peer:

```powershell
$providerIp = Read-Host 'Laptop 2 Wi-Fi IPv4'
New-NetFirewallRule -DisplayName 'BDGCE M1 backend from Laptop 2' -Direction Inbound -Action Allow -Protocol TCP -LocalPort 5000 -RemoteAddress $providerIp -Profile Private
```

Do not disable the firewall. No MongoDB, IPFS, or Hardhat LAN rule is needed for
Milestone 1. Hardhat access will be configured for the trusted peer in Milestone 2.
Remove this temporary rule when no longer needed:

```powershell
Remove-NetFirewallRule -DisplayName 'BDGCE M1 backend from Laptop 2'
```

## Exact Laptop 2 commands (Windows PowerShell)

Copy the updated project to Laptop 2 (or at least worker/preflight.py). Open
PowerShell in that project root. Do not copy Laptop 1's private .env files/keys.
Use the Python environment intended for the worker; if a virtual environment
already exists, use its python.exe instead of the global python below.

```powershell
Get-CimInstance Win32_OperatingSystem | Select-Object Caption,Version,OSArchitecture
Get-CimInstance Win32_VideoController | Select-Object Name,DriverVersion
Get-NetIPAddress -AddressFamily IPv4 | Format-Table InterfaceAlias,IPAddress
python --version
python -m pip show torch numpy
nvidia-smi
nvidia-smi --query-gpu=name,memory.total,driver_version --format=csv
$serverIp = '192.168.0.122'
Test-NetConnection -ComputerName $serverIp -Port 5000
Invoke-RestMethod "http://${serverIp}:5000/health" | ConvertTo-Json -Depth 6
python worker/preflight.py --backend-url "http://${serverIp}:5000" --output laptop2-preflight.json
$LASTEXITCODE
Get-Content laptop2-preflight.json
```

Replace 192.168.0.122 only if Laptop 1's current Wi-Fi address differs. Laptop 2
must not use localhost for the backend. If it runs Linux instead, run `uname -a`,
`ip -4 addr`, the same nvidia-smi commands, `python3 --version`,
`python3 -m pip show torch numpy`, and:

```bash
python3 worker/preflight.py --backend-url http://192.168.0.122:5000 --output laptop2-preflight.json
cat laptop2-preflight.json
```

Share the JSON and NVIDIA/OS command outputs. They contain no worker keys or
wallet private keys. A missing torch package is a software blocker, not proof of
missing hardware; choose its CUDA build only after the actual GPU/driver/OS are
known. nvidia-smi's displayed CUDA version alone is not sufficient evidence.

The diagnostic reports GPU memory, driver output, PyTorch CUDA build, compiled
architectures, each GPU's compute capability and actual CUDA result/device. It
requires exact GPU and CPU agreement with [[19,22],[43,50]]. GPU exceptions,
including out-of-memory and unsupported kernels, produce failure. The child has
a 60-second timeout; no CPU fallback or arbitrary workload input exists.

A pass establishes only the small known-answer CUDA check, not full Milestone 1
acceptance. Next, still within Milestone 1, implement and physically validate the
reproducible matrix workload with CPU comparison, safe .npy output, metadata,
warmup, synchronized transfer/kernel timings, and timeout/OOM handling. Stop at
that milestone checkpoint before any remote job or escrow integration work.
