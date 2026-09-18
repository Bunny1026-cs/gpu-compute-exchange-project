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
  - Sleeping for a random duration
  - Generating deterministic "result data" based on the job input
  - Computing a SHA-256 hash of the result
"""

import hashlib
import json
import random
import time
from datetime import datetime


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
    task_type = job.get("taskType", "inference")
    job_input = job.get("input", {})
    gpu_info = job.get("gpuId", {})

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
        result_data = _generate_result(job_id, task_type, job_input, gpu_info)

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


def _generate_result(job_id: str, task_type: str, job_input: dict, gpu_info: dict) -> dict:
    """
    Generate simulated computation results based on the task type.
    This is deterministic for the same input — useful for testing.
    """
    base_result = {
        "jobId": job_id,
        "taskType": task_type,
        "completedAt": datetime.utcnow().isoformat() + "Z",
        "gpu": {
            "model": gpu_info.get("gpuModel", "Unknown"),
            "memory": gpu_info.get("gpuMemory", 0),
        },
    }

    if task_type == "inference":
        # Simulate ML inference output
        base_result["output"] = {
            "predictions": [
                {"label": "cat", "confidence": round(random.uniform(0.85, 0.99), 4)},
                {"label": "dog", "confidence": round(random.uniform(0.01, 0.12), 4)},
                {"label": "bird", "confidence": round(random.uniform(0.001, 0.03), 4)},
            ],
            "model": job_input.get("model", "resnet50"),
            "preprocessTime": round(random.uniform(0.01, 0.1), 3),
            "inferenceTime": round(random.uniform(0.05, 0.5), 3),
        }

    elif task_type == "training":
        # Simulate training metrics
        epochs = job_input.get("epochs", 5)
        base_result["output"] = {
            "epochs": epochs,
            "finalLoss": round(random.uniform(0.01, 0.5), 4),
            "finalAccuracy": round(random.uniform(0.85, 0.99), 4),
            "history": [
                {
                    "epoch": i + 1,
                    "loss": round(0.5 * (0.7 ** i) + random.uniform(-0.02, 0.02), 4),
                    "accuracy": round(min(0.99, 0.6 + 0.08 * i + random.uniform(-0.01, 0.01)), 4),
                }
                for i in range(epochs)
            ],
            "model": job_input.get("model", "custom_model"),
            "totalTime": round(random.uniform(10, 120), 2),
        }

    elif task_type == "fine-tuning":
        base_result["output"] = {
            "baseModel": job_input.get("model", "bert-base"),
            "finalLoss": round(random.uniform(0.05, 0.3), 4),
            "finalAccuracy": round(random.uniform(0.88, 0.98), 4),
            "learningRate": job_input.get("learningRate", 2e-5),
            "totalSteps": random.randint(500, 5000),
        }

    elif task_type == "render":
        base_result["output"] = {
            "resolution": job_input.get("resolution", "1920x1080"),
            "frames": job_input.get("frames", 1),
            "renderEngine": job_input.get("engine", "cycles"),
            "renderTime": round(random.uniform(5, 60), 2),
            "samplesPerPixel": random.randint(128, 4096),
        }

    else:
        # Generic output
        base_result["output"] = {
            "message": f"Computation complete for task type: {task_type}",
            "inputSummary": str(job_input)[:200] if job_input else "No input provided",
            "randomMetric": round(random.uniform(0, 100), 4),
        }

    return base_result
