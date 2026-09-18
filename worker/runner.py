"""
runner.py
GPU Compute Exchange — Job Runner (Main Entry Point)

This is the main process for the GPU worker. It:
  1. Polls the backend for ASSIGNED jobs
  2. Picks up one job at a time
  3. Marks it as RUNNING
  4. Invokes the executor to simulate GPU computation
  5. Submits results (hash + data → IPFS via backend)
  6. Triggers the completion pipeline (verify + pay)
  7. Loops back to step 1

Usage:
  cd worker
  pip install -r requirements.txt
  python runner.py

Environment:
  Copy worker/.env.example to worker/.env and configure.
"""

import sys
import time
import traceback

from config import Config
from executor import execute_job
from result_handler import ResultHandler


def run_worker():
    """Main worker loop — polls for jobs and processes them."""

    # ── Validate configuration ─────────────────────────────────
    print()
    Config.display()
    try:
        Config.validate()
    except ValueError as e:
        print(f"\n❌ {e}")
        print("\nCopy worker/.env.example to worker/.env and fill in values.")
        sys.exit(1)

    # ── Initialize result handler ──────────────────────────────
    handler = ResultHandler(Config.BACKEND_URL, Config.WORKER_API_KEY)

    print(f"\n🚀 GPU Worker started. Polling every {Config.POLL_INTERVAL_SECONDS}s...\n")

    consecutive_errors = 0
    max_consecutive_errors = 10

    while True:
        try:
            # ── 1. Poll for ASSIGNED jobs ──────────────────────
            jobs = handler.fetch_assigned_jobs()

            if not jobs:
                # No jobs — wait and poll again
                time.sleep(Config.POLL_INTERVAL_SECONDS)
                consecutive_errors = 0
                continue

            print(f"\n📋 Found {len(jobs)} assigned job(s)")

            # ── 2. Process one job at a time ───────────────────
            for job in jobs:
                job_id = job.get("_id", "unknown")
                print(f"\n{'━' * 55}")
                print(f"  📌 Processing job: {job_id}")
                print(f"{'━' * 55}")

                try:
                    process_single_job(handler, job)
                except Exception as e:
                    print(f"\n  ❌ Unexpected error processing job {job_id}: {e}")
                    traceback.print_exc()
                    try:
                        handler.fail_job(job_id, f"Worker error: {str(e)}")
                    except Exception:
                        print(f"  ⚠️  Could not report failure to backend.")

            consecutive_errors = 0

        except KeyboardInterrupt:
            print("\n\n👋 Worker shutting down (Ctrl+C)...")
            break

        except Exception as e:
            consecutive_errors += 1
            print(f"\n⚠️  Polling error ({consecutive_errors}/{max_consecutive_errors}): {e}")

            if consecutive_errors >= max_consecutive_errors:
                print(f"\n❌ Too many consecutive errors. Exiting.")
                sys.exit(1)

            # Exponential backoff on errors
            wait_time = min(60, Config.POLL_INTERVAL_SECONDS * (2 ** consecutive_errors))
            print(f"   Retrying in {wait_time}s...")
            time.sleep(wait_time)


def process_single_job(handler: ResultHandler, job: dict):
    """
    Process a single assigned job through the full lifecycle:
      ASSIGNED → RUNNING → RESULT_UPLOADED → COMPLETED
    """
    job_id = job["_id"]

    # ── Step 1: Mark as RUNNING ────────────────────────────────
    print(f"\n  📡 Notifying backend: ASSIGNED → RUNNING")
    try:
        handler.start_job(job_id)
        print(f"  ✅ Job {job_id} is now RUNNING")
    except Exception as e:
        print(f"  ❌ Failed to start job: {e}")
        raise

    # ── Step 2: Execute the job ────────────────────────────────
    print(f"\n  🖥️  Starting GPU computation...")
    result = execute_job(
        job,
        min_time=Config.MIN_EXECUTION_TIME,
        max_time=Config.MAX_EXECUTION_TIME,
    )

    if result["status"] == "error":
        print(f"\n  ❌ Execution failed: {result['error']}")
        handler.fail_job(job_id, result["error"])
        return

    # ── Step 3: Submit result to backend ───────────────────────
    print(f"\n  📤 Submitting result to backend...")
    try:
        submit_resp = handler.submit_result(
            job_id,
            result_hash=result["result_hash"],
            result_data=result["result_data"],
        )
        ipfs_cid = submit_resp.get("data", {}).get("ipfsCid")
        if ipfs_cid:
            print(f"  📦 Result stored in IPFS: {ipfs_cid}")
        print(f"  ✅ Result submitted. Job → RESULT_UPLOADED")
    except Exception as e:
        print(f"  ❌ Failed to submit result: {e}")
        handler.fail_job(job_id, f"Result submission failed: {str(e)}")
        return

    # ── Step 4: Trigger completion (verify + pay) ──────────────
    print(f"\n  🔐 Triggering verification & payment pipeline...")
    try:
        complete_resp = handler.complete_job(job_id)
        print(f"  ✅ Job {job_id} → COMPLETED")
        bc_tx = complete_resp.get("data", {}).get("blockchainTxHash")
        if bc_tx:
            print(f"  ⛓️  Blockchain tx: {bc_tx}")
    except Exception as e:
        print(f"  ⚠️  Completion pipeline error: {e}")
        print(f"      Job result was submitted successfully. Manual completion may be needed.")

    print(f"\n  🎉 Job {job_id} fully processed!")


if __name__ == "__main__":
    run_worker()
