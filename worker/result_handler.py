"""
result_handler.py
GPU Compute Exchange — Result Handler

Handles:
  1. Submitting computation results back to the backend
  2. Triggering job completion (verification + payment pipeline)
  3. Reporting job failures
"""

import requests


class ResultHandler:
    """Handles communication with the backend for job results."""

    def __init__(self, backend_url: str, api_key: str):
        self.backend_url = backend_url.rstrip("/")
        self.headers = {
            "Content-Type": "application/json",
            "X-Worker-API-Key": api_key,
        }

    def start_job(self, job_id: str) -> dict:
        """
        Notify the backend that a job has started.
        Transitions: ASSIGNED → RUNNING
        """
        url = f"{self.backend_url}/worker/jobs/{job_id}/start"
        resp = requests.post(url, headers=self.headers, timeout=10)
        resp.raise_for_status()
        return resp.json()

    def submit_result(self, job_id: str, result_hash: str, result_data: dict = None) -> dict:
        """
        Submit computation results to the backend.
        Transitions: RUNNING → RESULT_UPLOADED

        Args:
            job_id:      MongoDB job ID.
            result_hash: SHA-256 hex digest of the result.
            result_data: Optional result data to upload to IPFS via backend.
        """
        url = f"{self.backend_url}/worker/jobs/{job_id}/result"
        payload = {"resultHash": result_hash}
        if result_data:
            payload["resultData"] = result_data

        resp = requests.post(url, json=payload, headers=self.headers, timeout=30)
        resp.raise_for_status()
        return resp.json()

    def complete_job(self, job_id: str) -> dict:
        """
        Trigger the verification + payment pipeline.
        Transitions: RESULT_UPLOADED → COMPLETED
        """
        url = f"{self.backend_url}/worker/jobs/{job_id}/complete"
        resp = requests.post(url, headers=self.headers, timeout=30)
        resp.raise_for_status()
        return resp.json()

    def fail_job(self, job_id: str, reason: str) -> dict:
        """
        Report a job failure.
        Transitions: RUNNING/ASSIGNED → FAILED
        """
        url = f"{self.backend_url}/worker/jobs/{job_id}/fail"
        payload = {"reason": reason}
        resp = requests.post(url, json=payload, headers=self.headers, timeout=10)
        resp.raise_for_status()
        return resp.json()

    def fetch_assigned_jobs(self) -> list:
        """
        Poll the backend for jobs in ASSIGNED status.
        Returns a list of job documents.
        """
        url = f"{self.backend_url}/worker/jobs"
        resp = requests.get(url, headers=self.headers, timeout=10)
        resp.raise_for_status()
        data = resp.json()
        return data.get("data", [])
