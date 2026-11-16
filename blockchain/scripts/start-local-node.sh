#!/bin/sh
# scripts/start-local-node.sh
# Starts a persistent local Hardhat node and deploys GPUComputeEscrow to it.
#
# RECONSTRUCTED (P0-5): the original file was excluded from the repository by
# a root .gitignore rule. Behaviour follows the blockchain Dockerfile comment
# ("Start a persistent Hardhat node and deploy the local demo contract") and
# the documented workflow in backend/.env.example (node, then deploy.js).
#
# Used as the CMD of blockchain/Dockerfile. Listens on 0.0.0.0:8545 so other
# Compose services can reach it at http://hardhat-node:8545.
set -eu

RPC_URL="http://127.0.0.1:8545"

npx hardhat node --hostname 0.0.0.0 --port 8545 &
NODE_PID=$!

# Stop the node if this script is interrupted.
trap 'kill "$NODE_PID" 2>/dev/null || true' INT TERM

# Wait (up to ~60 s) for the JSON-RPC endpoint to answer.
i=0
until node -e "fetch('$RPC_URL',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method:'eth_chainId',params:[]})}).then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"; do
  i=$((i + 1))
  if [ "$i" -ge 60 ]; then
    echo "Hardhat node did not become ready on $RPC_URL" >&2
    kill "$NODE_PID" 2>/dev/null || true
    exit 1
  fi
  sleep 1
done

npx hardhat run scripts/deploy.js --network localhost

# Keep the container attached to the node process.
wait "$NODE_PID"
