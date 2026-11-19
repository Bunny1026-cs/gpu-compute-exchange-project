# QA commands and isolation

PowerShell from the repository root on Windows. The run used the current working tree at base commit `744c645`, MongoDB 7 on port 27017, local Hardhat chain 31337 on 8561, API on 5021, Vite on 5191 and a provider-only test relay on 5022. The isolated database was `bdgce_qa_9a903abcc8`. The existing interactive application used separate ports and a separate database. The QA backend used local artifact storage.

The [QA harness](harness/) is the source used for this run. Scripts resolve their private state relative to `runtime/qa-n19`. For a repeat, use a fresh scratch directory at that path and archive this evidence directory first. Generated account passwords, the provider wallet key, pair codes and agent credentials belong in ignored runtime storage. The setup deploys the compiled project contract with the usual owner and operator, funds a new provider wallet with one local test ETH and generates three new app users. It does not change the interactive deployment metadata.

```powershell
New-Item -Type Directory -Force runtime/qa-n19 | Out-Null
Copy-Item evidence/qa-n19/harness/*.cjs runtime/qa-n19/
# Separate terminal (Hardhat startup prints public development private keys, so suppress its console).
npm.cmd --prefix blockchain run node -- --hostname 127.0.0.1 --port 8561 *> $null
# With the chain ready, run in a separate terminal:
node runtime/qa-n19/setup.cjs
$env:BACKEND_ENV_FILE=(Resolve-Path runtime/qa-n19/backend.env).Path
node backend/index.js
# Frontend terminal:
$env:BACKEND_PROXY_URL='http://127.0.0.1:5021'
npm.cmd --prefix frontend run dev -- --host 127.0.0.1 --port 5191 --strictPort
# Provider test relay terminal:
node runtime/qa-n19/proxy.cjs
# Browser runner terminal. This run used the installed Playwright package in the npm cache.
$env:NODE_PATH=Join-Path $env:LOCALAPPDATA 'npm-cache/_npx/e41f203b7505f1fb/node_modules'
node runtime/qa-n19/run.cjs
# Agent terminal. The browser runner issues the single-use code through the provider dashboard.
$env:WORKER_ENV_FILE=(Resolve-Path runtime/qa-n19/worker.env).Path
python worker/agent.py --discover --cpu-dev
while (!(Test-Path runtime/qa-n19/pair)) {Start-Sleep -Seconds 1}
$env:BACKEND_URL='http://127.0.0.1:5022/api'
python -u worker/agent.py --cpu-dev --pair (Get-Content runtime/qa-n19/pair -Raw) --state runtime/qa-n19/paired.json
```

The relay forwarded real agent requests to the QA API. It replayed one successful upload unchanged, dropped the QA agent link during the disconnect job, then submitted a result using the expired lease. The browser suite waited until the real five-minute deadline to test pairing expiry. For the supplementary pause test, wait for the link to reconnect and for a fresh heartbeat.

```powershell
node runtime/qa-n19/drain.cjs
# Matrix worker terminal. The separate native executor performs the matrix regression.
node runtime/qa-n19/matrix.cjs prepare
$env:WORKER_ENV_FILE=(Resolve-Path runtime/qa-n19/matrix.env).Path
python -u worker/runner.py
# Another terminal:
node runtime/qa-n19/matrix.cjs
node runtime/qa-n19/audit.cjs
npm.cmd test --prefix backend
npm.cmd test --prefix blockchain
Push-Location worker
python -m unittest discover -s tests -v
Pop-Location
npm.cmd run build --prefix frontend
npm.cmd run lint --prefix frontend
```

The additional numerical check loaded the downloaded `matrix.npy` with `allow_pickle=False`, regenerated the two 64×64 inputs with NumPy PCG64 seed 42, rounded each input to float32, and multiplied in float64. All 4,096 entries matched with `rtol=1e-4` and `atol=1e-4`. The live offline-draft check queried the provider's slot during the link outage and posted a CPU job from the consumer account after the heartbeat became stale.
