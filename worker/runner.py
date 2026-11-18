"""Native real-compute provider. No simulated execution or CPU fallback."""
import base64
import json
import os
from pathlib import Path
import subprocess
import threading
import time
import uuid

import requests
from dotenv import load_dotenv
from matrix_workload import execute

ROOT = Path(__file__).resolve().parent
load_dotenv(os.getenv("WORKER_ENV_FILE", str(ROOT / ".env")))


def signer(*args):
    result = subprocess.run(["node", str(ROOT / "provider_signer.cjs"), *args],
                            capture_output=True, text=True, timeout=50, check=False)
    if result.returncode:
        raise RuntimeError(result.stderr)
    return json.loads(result.stdout)


class Worker:
    def __init__(self):
        self.mode = os.getenv("EXECUTION_MODE", "real_gpu")
        if self.mode not in ("real_gpu", "real_cpu_test"):
            raise ValueError("Only real_gpu or explicit real_cpu_test is allowed")
        if os.getenv("FINAL_DEMO", "true").lower() == "true" and self.mode != "real_gpu":
            raise ValueError("Final demo requires real_gpu")
        self.url = os.environ["BACKEND_URL"].rstrip("/")
        self.key = os.environ["WORKER_API_KEY"]
        self.session = str(uuid.uuid4())
        self.wallet = signer("address")["address"]
        probe = subprocess.run([os.sys.executable, str(ROOT / "matrix_workload.py"),
                                "capabilities", "--mode", self.mode],
                               capture_output=True, text=True, timeout=60, check=False)
        if probe.returncode:
            raise RuntimeError(probe.stdout or probe.stderr)
        self.capabilities = json.loads(probe.stdout)
        self.current = None
        self.stopped = threading.Event()
        self.output = ROOT / "results"
        self.output.mkdir(exist_ok=True)

    def api(self, method, route, job=None, **kwargs):
        headers = {"X-Worker-API-Key": self.key, "X-Worker-Session": self.session}
        if job:
            headers["X-Job-Lease"] = job["leaseId"]
        headers.update(kwargs.pop("headers", {}))
        response = requests.request(method, self.url + route, headers=headers, timeout=90, **kwargs)
        if not response.ok:
            raise RuntimeError(f"HTTP {response.status_code}: {response.text[:1500]}")
        return response.json()["data"]

    def heartbeat(self):
        body = {"capabilities": self.capabilities, "walletAddress": self.wallet}
        job = self.current
        if job:
            body.update(jobId=job["_id"], leaseId=job["leaseId"])
        return self.api("POST", "/worker/heartbeat", json=body)

    def heartbeats(self):
        while not self.stopped.wait(10):
            try:
                self.heartbeat()
            except Exception as error:
                print("Heartbeat failed:", error, flush=True)

    def process(self, job):
        self.current = job
        self.heartbeat()
        route = "/worker/jobs/" + job["_id"]
        try:
            if job["spec"]["executionMode"] != self.mode:
                raise ValueError("Workload execution mode mismatch")
            if job["status"] in ("ASSIGNED", "RUNNING"):
                self.api("POST", route + "/start", job, json={})
                file = self.output / (job["_id"] + ".npy")
                try:
                    metadata = execute(job["spec"], file, timeout=min(120, job["reservedMinutes"] * 60))
                except Exception as error:
                    self.api("POST", route + "/fail", job, json={"reason": str(error)[:1000]})
                    return
                (self.output / (job["_id"] + ".json")).write_text(json.dumps(metadata, indent=2), encoding="utf-8")
                t0 = time.perf_counter()
                accepted = self.api("POST", route + "/result", job, data=file.read_bytes(), headers={
                    "Content-Type": "application/octet-stream",
                    "X-Result-Hash": metadata["sha256"],
                    "X-Result-Metadata": base64.b64encode(json.dumps(metadata).encode()).decode(),
                })
                print(json.dumps({"jobId": job["_id"], "uploadAndVerifyMs": (time.perf_counter()-t0)*1000}), flush=True)
                result_hash = accepted["resultHash"]
            else:
                result_hash = job["resultHash"]
            receipt = signer(job["contractAddress"], job["blockchainJobId"], "0x" + result_hash, job["chainInstance"])
            print(json.dumps({"providerSubmission": receipt, "jobId": job["_id"]}), flush=True)
            completed = self.api("POST", route + "/complete", job, json={})
            print(json.dumps({"jobId": job["_id"], "status": completed["status"]}), flush=True)
        finally:
            self.current = None

    def run(self):
        self.heartbeat()
        thread = threading.Thread(target=self.heartbeats, daemon=True)
        thread.start()
        print(json.dumps({"worker": "ready", "mode": self.mode, "capabilities": self.capabilities}), flush=True)
        try:
            while not self.stopped.is_set():
                try:
                    for job in self.api("GET", "/worker/jobs"):
                        self.process(job)
                except Exception as error:
                    # Preserve accepted artifacts and escrow; poll same lease to retry safely.
                    print("Worker retry:", error, flush=True)
                self.stopped.wait(3)
        finally:
            self.stopped.set()


if __name__ == "__main__":
    try:
        Worker().run()
    except KeyboardInterrupt:
        print("Worker stopped")
