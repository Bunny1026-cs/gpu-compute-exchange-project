"""Native real-compute provider. No simulated execution or CPU fallback."""
import base64
import json
import os
from pathlib import Path
import subprocess
import threading
import tempfile
import time
import uuid
from contextlib import contextmanager

import requests
from dotenv import load_dotenv
from matrix_workload import execute

ROOT = Path(__file__).resolve().parent
load_dotenv(os.getenv("WORKER_ENV_FILE", str(ROOT / ".env")))


@contextmanager
def device_lock(capabilities):
    """Hold an OS lock while this physical GPU is advertised, across worker slots."""
    if capabilities["executionMode"] != "real_gpu":
        yield
        return
    import hashlib
    # CUDA_VISIBLE_DEVICES can renumber the same physical device across processes.
    device = capabilities.get("deviceUuid") or "unidentified-cuda-device"
    key = hashlib.sha256(device.encode()).hexdigest()
    lockfile = Path(tempfile.gettempdir()) / ("bdgce-gpu-" + key + ".lock")
    with lockfile.open("a+b") as handle:
        try:
            if os.name == "nt":
                import msvcrt
                if handle.tell() == 0:
                    handle.write(b"0")
                    handle.flush()
                handle.seek(0)
                msvcrt.locking(handle.fileno(), msvcrt.LK_NBLCK, 1)
            else:
                import fcntl
                fcntl.flock(handle, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except OSError as error:
            raise RuntimeError("Another worker owns this GPU, or its device lock is inaccessible") from error
        yield


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
        self.wallet = signer("preflight")["address"]
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
        timing_file = self.output / (job["_id"] + ".timing.json")
        timing = {"jobId": job["_id"]}
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
                artifact = file.read_bytes()
                t0 = time.perf_counter()
                accepted = self.api("POST", route + "/result", job, data=artifact, headers={
                    "Content-Type": "application/octet-stream",
                    "X-Result-Hash": metadata["sha256"],
                    "X-Result-Metadata": base64.b64encode(json.dumps(metadata).encode()).decode(),
                })
                timing["uploadAndVerifyMs"] = (time.perf_counter() - t0) * 1000
                timing_file.write_text(json.dumps(timing, indent=2), encoding="utf-8")
                result_hash = accepted["resultHash"]
            else:
                result_hash = job["resultHash"]
                if timing_file.exists():
                    timing = json.loads(timing_file.read_text(encoding="utf-8"))
            receipt = signer(job["contractAddress"], job["blockchainJobId"], "0x" + result_hash, job["chainInstance"])
            if "txHash" in receipt:
                timing["providerReceipt"] = receipt
                timing_file.write_text(json.dumps(timing, indent=2), encoding="utf-8")
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
        worker = Worker()
        with device_lock(worker.capabilities):
            worker.run()
    except KeyboardInterrupt:
        print("Worker stopped")
