"""
config.py
GPU Compute Exchange — Worker Configuration

Reads configuration from environment variables.
Copy worker/.env.example to worker/.env and fill in values.
"""

import os
from dotenv import load_dotenv

# Load .env file if present
load_dotenv()


class Config:
    """Worker configuration from environment variables."""

    # Backend API
    BACKEND_URL = os.getenv("BACKEND_URL", "http://localhost:5000/api")
    WORKER_API_KEY = os.getenv("WORKER_API_KEY", "")

    # Polling
    POLL_INTERVAL_SECONDS = int(os.getenv("POLL_INTERVAL_SECONDS", "5"))

    # Execution
    # Maximum time (seconds) to simulate GPU computation
    MAX_EXECUTION_TIME = int(os.getenv("MAX_EXECUTION_TIME", "10"))
    # Minimum time (seconds) to simulate GPU computation
    MIN_EXECUTION_TIME = int(os.getenv("MIN_EXECUTION_TIME", "2"))

    # Docker (for real GPU execution — Phase 9+)
    DOCKER_ENABLED = os.getenv("DOCKER_ENABLED", "false").lower() == "true"
    DOCKER_BASE_IMAGE = os.getenv("DOCKER_BASE_IMAGE", "nvidia/cuda:12.2.0-runtime-ubuntu22.04")
    DOCKER_GPU_RUNTIME = os.getenv("DOCKER_GPU_RUNTIME", "nvidia")

    # IPFS
    IPFS_API_URL = os.getenv("IPFS_API_URL", "")

    @classmethod
    def validate(cls):
        """Validate required configuration."""
        errors = []
        if not cls.WORKER_API_KEY:
            errors.append("WORKER_API_KEY is required")
        if not cls.BACKEND_URL:
            errors.append("BACKEND_URL is required")
        if errors:
            raise ValueError(
                "Worker configuration errors:\n  - " + "\n  - ".join(errors)
            )

    @classmethod
    def display(cls):
        """Print configuration (safe — no secrets)."""
        print("═" * 55)
        print("  GPU Compute Exchange — Worker Configuration")
        print("═" * 55)
        print(f"  Backend URL:       {cls.BACKEND_URL}")
        print(f"  API Key:           {'*' * 8}...{cls.WORKER_API_KEY[-4:] if len(cls.WORKER_API_KEY) > 4 else '(not set)'}")
        print(f"  Poll Interval:     {cls.POLL_INTERVAL_SECONDS}s")
        print(f"  Execution Time:    {cls.MIN_EXECUTION_TIME}–{cls.MAX_EXECUTION_TIME}s")
        print(f"  Docker Enabled:    {cls.DOCKER_ENABLED}")
        print(f"  IPFS API:          {cls.IPFS_API_URL or '(not set — backend handles IPFS)'}")
        print("═" * 55)
