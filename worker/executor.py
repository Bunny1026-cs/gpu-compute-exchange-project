"""
executor.py
GPU Compute Exchange — Job Executor

Handles the actual GPU job execution (simulated for demo).

In a real production system, this module would:
  1. Pull a Docker image with the correct CUDA version
  2. Mount the user's ML scripts/data
  3. Run the container with --runtime=nvidia
  4. Stream stdout/stderr
  5. Capture output files

For the demo, we simulate computation by:
  - Sleeping for a random duration (does not affect the result)
  - Generating simulated "result data" that is deterministic for the same
    job (P1-4): every simulated value comes from a random.Random seeded with
    a SHA-256 digest of (job id, task type, input, GPU model/memory)
  - Computing a SHA-256 hash of exactly the result data that is submitted

The wall-clock completion time is returned separately as "completed_at" and
is NOT part of the hashed result, so re-running the same job reproduces the
same result_hash.

This is a SIMULATION. No GPU code is executed.
"""

import hashlib
import json
import random
import time
from datetime import datetime, timezone


def execute_job(job: dict, min_time: int = 2, max_time: int = 10) -> dict:
    """
    Execute a GPU compute job (simulated).

    Args:
        job:      Job document from the backend API.
        min_time: Minimum simulated execution time (seconds).
        max_time: Maximum simulated execution time (seconds).

    Returns:
        dict with keys:
          - result_hash: SHA-256 hex digest of the result
          - result_data: The computed result (simulated)
          - execution_time: How long the job took (seconds)
          - status: "success" or "error"
          - error: Error message (if status == "error")
    """
    job_id = job.get("_id", "unknown")
    task_type = job.get("taskType") or "inference"
    # P1-4: the backend sends null for absent input / deleted GPU. dict.get's
    # default only applies when the key is missing, so normalise explicitly.
    job_input = job.get("input")
    job_input = job_input if isinstance(job_input, dict) else {}
    gpu_info = job.get("gpuId")
    gpu_info = gpu_info if isinstance(gpu_info, dict) else {}

    print(f"  ⚙️  Executing job {job_id}")
    print(f"      Task type:  {task_type}")
    print(f"      GPU:        {gpu_info.get('gpuModel', 'N/A')} ({gpu_info.get('gpuMemory', '?')} GB)")

    start_time = time.time()

    try:
        # ── Simulate GPU computation ─────────────────────────
        execution_seconds = random.uniform(min_time, max_time)
        print(f"      Simulating {task_type} computation ({execution_seconds:.1f}s)...")

        # Simulate progress updates
        elapsed = 0
        step = max(0.5, execution_seconds / 5)
        while elapsed < execution_seconds:
            time.sleep(min(step, execution_seconds - elapsed))
            elapsed += step
            progress = min(100, int((elapsed / execution_seconds) * 100))
            print(f"      Progress: {progress}%")

        # ── Generate result data ─────────────────────────────
        rng = random.Random(_seed_for(job_id, task_type, job_input, gpu_info))
        result_data = _generate_result(job_id, task_type, job_input, gpu_info, rng)

        # ── Compute result hash ──────────────────────────────
        result_json = json.dumps(result_data, sort_keys=True)
        result_hash = hashlib.sha256(result_json.encode("utf-8")).hexdigest()

        execution_time = round(time.time() - start_time, 2)

        print(f"  ✅  Job {job_id} completed in {execution_time}s")
        print(f"      Result hash: {result_hash[:16]}...")

        return {
            "result_hash": result_hash,
            "result_data": result_data,
            "execution_time": execution_time,
            "completed_at": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
            "status": "success",
            "error": None,
        }

    except Exception as e:
        execution_time = round(time.time() - start_time, 2)
        print(f"  ❌  Job {job_id} failed after {execution_time}s: {e}")
        return {
            "result_hash": None,
            "result_data": None,
            "execution_time": execution_time,
            "status": "error",
            "error": str(e),
        }


def _seed_for(job_id, task_type, job_input: dict, gpu_info: dict) -> int:
    """Deterministic RNG seed from the job's identifying content (P1-4)."""
    material = json.dumps(
        {
            "jobId": str(job_id),
            "taskType": task_type,
            "input": job_input,
            "gpu": {"model": gpu_info.get("gpuModel"), "memory": gpu_info.get("gpuMemory")},
        },
        sort_keys=True,
        default=str,
    )
    return int(hashlib.sha256(material.encode("utf-8")).hexdigest(), 16)


def _as_int(value, default: int) -> int:
    """Best-effort integer conversion for user-supplied numeric fields."""
    try:
        return int(value)
    except (TypeError, ValueError):
        return default


def _generate_result(job_id: str, task_type: str, job_input: dict, gpu_info: dict,
                     rng: random.Random) -> dict:
    """
    Generate simulated computation results based on the task type.
    Deterministic for the same (job id, task type, input, GPU) because every
    simulated value is drawn from the seeded `rng` (P1-4).
    """
    base_result = {
        "jobId": job_id,
        "taskType": task_type,
        "gpu": {
            "model": gpu_info.get("gpuModel", "Unknown"),
            "memory": gpu_info.get("gpuMemory", 0),
        },
    }

    if task_type == "inference":
        # Simulate ML inference output
        base_result["output"] = {
            "predictions": [
                {"label": "cat", "confidence": round(rng.uniform(0.85, 0.99), 4)},
                {"label": "dog", "confidence": round(rng.uniform(0.01, 0.12), 4)},
                {"label": "bird", "confidence": round(rng.uniform(0.001, 0.03), 4)},
            ],
            "model": job_input.get("model", "resnet50"),
            "preprocessTime": round(rng.uniform(0.01, 0.1), 3),
            "inferenceTime": round(rng.uniform(0.05, 0.5), 3),
        }

    elif task_type == "training":
        # Simulate training metrics
        epochs = max(0, _as_int(job_input.get("epochs", 5), 5))
        base_result["output"] = {
            "epochs": epochs,
            "finalLoss": round(rng.uniform(0.01, 0.5), 4),
            "finalAccuracy": round(rng.uniform(0.85, 0.99), 4),
            "history": [
                {
                    "epoch": i + 1,
                    "loss": round(0.5 * (0.7 ** i) + rng.uniform(-0.02, 0.02), 4),
                    "accuracy": round(min(0.99, 0.6 + 0.08 * i + rng.uniform(-0.01, 0.01)), 4),
                }
                for i in range(epochs)
            ],
            "model": job_input.get("model", "custom_model"),
            "totalTime": round(rng.uniform(10, 120), 2),
        }

    elif task_type == "fine-tuning":
        base_result["output"] = {
            "baseModel": job_input.get("model", "bert-base"),
            "finalLoss": round(rng.uniform(0.05, 0.3), 4),
            "finalAccuracy": round(rng.uniform(0.88, 0.98), 4),
            "learningRate": job_input.get("learningRate", 2e-5),
            "totalSteps": rng.randint(500, 5000),
        }

    elif task_type == "render":
        base_result["output"] = {
            "resolution": job_input.get("resolution", "1920x1080"),
            "frames": job_input.get("frames", 1),
            "renderEngine": job_input.get("engine", "cycles"),
            "renderTime": round(rng.uniform(5, 60), 2),
            "samplesPerPixel": rng.randint(128, 4096),
        }

    else:
        # Generic output
        base_result["output"] = {
            "message": f"Computation complete for task type: {task_type}",
            "inputSummary": str(job_input)[:200] if job_input else "No input provided",
            "randomMetric": round(rng.uniform(0, 100), 4),
        }

    return base_result
