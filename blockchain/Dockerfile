# ============================================================
# GPU Compute Exchange — Blockchain (Hardhat Node) Dockerfile
# ============================================================
FROM node:18-alpine

WORKDIR /app

# Install dependencies
COPY package.json package-lock.json ./
RUN npm ci

# Copy project files
COPY . .

# Compile contracts
RUN npx hardhat compile

# Expose Hardhat JSON-RPC port
EXPOSE 8545

# Start a persistent Hardhat node and deploy the local demo contract.
CMD ["sh", "scripts/start-local-node.sh"]
