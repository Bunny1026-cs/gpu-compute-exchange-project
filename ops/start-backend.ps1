$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path $PSScriptRoot -Parent
$env:BACKEND_ENV_FILE = Join-Path $projectRoot 'runtime/backend.env'
Set-Location (Join-Path $projectRoot 'backend')
node index.js
