# ============================================================
# GPU Compute Exchange — Worker Dockerfile
# ============================================================
FROM python:3.11-slim

WORKDIR /app

# Install dependencies
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy application code
COPY . .

# The worker runs as a long-running polling process
CMD ["python", "runner.py"]
