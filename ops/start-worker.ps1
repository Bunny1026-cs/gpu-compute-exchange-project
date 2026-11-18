param([string]$EnvFile = '', [string]$Python = 'python')
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path $PSScriptRoot -Parent
if (!$EnvFile) { $EnvFile = Join-Path $projectRoot 'worker/.env' }
$env:WORKER_ENV_FILE = (Resolve-Path -LiteralPath $EnvFile).Path
if (Test-Path -LiteralPath $Python) { $Python = (Resolve-Path -LiteralPath $Python).Path }
Set-Location (Join-Path $projectRoot 'worker')
& $Python runner.py
