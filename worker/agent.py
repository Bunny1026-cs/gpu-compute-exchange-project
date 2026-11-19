"""Pair once, then serve each discovered device with its own existing worker session."""
import argparse
import base64
import hashlib
import json
import os
from pathlib import Path
import threading
import uuid

import requests
from runner import Worker, ROOT, device_lock, signer
from batch_executor import discover, execute_script, probe

STATE = ROOT.parent / "runtime" / "paired-agent.json"
# Devices on this agent share a provider signer and its Ethereum nonce sequence.
SIGNING = threading.Lock()


class BatchWorker(Worker):
    def __init__(self, url, key, wallet, device):
        self.url, self.key, self.wallet = url, key, wallet
        self.capabilities = device
        self.mode = device["executionMode"]
        self.session = str(uuid.uuid4())
        self.current = None
        self.stopped = threading.Event()

    def process(self, job):
        route = "/worker/jobs/" + job["_id"]
        if job["taskType"] != "python_batch":
            raise RuntimeError("Unsupported assignment")
        if job["status"] == "QUEUED":
            if job.get("readyLease") == job["leaseId"]:
                return
            try:
                ready = (probe(self.capabilities)["testedImage"] == job["spec"]["image"] and
                         signer("preflight")["address"].lower() == self.wallet.lower())
            except Exception:
                ready = False
            self.api("POST", route + "/ready", job, json={"ready":ready})
            return
        self.current = job
        try:
            self.heartbeat()
            if job["status"] in ("ASSIGNED","RUNNING"):
                self.api("POST",route+"/start",job,json={})
                source = self.api("GET",route+"/source",job)["source"]
                try:
                    bundle, elapsed = execute_script(job["spec"], source, self.capabilities,
                        lambda tail: self.api("POST", route+"/log",job,json={"tail":tail}))
                except Exception as error:
                    self.api("POST",route+"/fail",job,json={"reason":str(error)[:1000],
                             "metadata":getattr(error,"metadata",{})})
                    return
                digest = hashlib.sha256(bundle).hexdigest()
                metadata = dict(spec=job["spec"],sha256=digest,artifactBytes=len(bundle),exitCode=0,
                                elapsedMs=elapsed,device=self.capabilities["deviceKey"],
                                runtime=self.capabilities["runtime"],capabilities=self.capabilities)
                self.api("POST",route+"/result",job,data=bundle,headers={"Content-Type":"application/octet-stream",
                         "X-Result-Hash":digest,"X-Result-Metadata":base64.b64encode(json.dumps(metadata).encode()).decode()})
            else:
                digest = job["resultHash"]
            with SIGNING:
                signer(job["contractAddress"], job["blockchainJobId"], "0x" + digest, job["chainInstance"])
            self.api("POST",route+"/complete",job,json={})
        finally:
            self.current = None


def post(url, data, headers=None):
    response = requests.post(url,json=data,headers=headers,timeout=20)
    response.raise_for_status()
    return response.json()["data"]


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--pair", metavar="CODE")
    parser.add_argument("--cpu-dev", action="store_true")
    parser.add_argument("--discover", action="store_true", help="Probe local runtimes and print the device inventory, then exit")
    parser.add_argument("--state", type=Path, default=STATE)
    args = parser.parse_args()
    if args.discover:
        print(json.dumps(discover(args.cpu_dev), indent=2))
        return
    url = os.environ["BACKEND_URL"].rstrip("/")
    wallet = signer("preflight")["address"]
    if args.cpu_dev and os.getenv("FINAL_DEMO","true").lower() != "false":
        raise ValueError("Set FINAL_DEMO=false to enable the CPU development slot")
    if args.pair:
        args.state.parent.mkdir(parents=True,exist_ok=True)
        if args.state.exists():
            raise ValueError("Already paired. Start without --pair or choose a new --state file")
        paired = post(url+"/agents/pair",dict(code=args.pair,wallet=wallet))
        with os.fdopen(os.open(args.state,os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o600),"w") as out:
            json.dump(dict(url=url,key=paired["key"]),out)
    state = json.loads(args.state.read_text())
    if state["url"] != url:
        raise ValueError("Pairing belongs to another backend")
    threads = []
    for device in discover(args.cpu_dev):
        slot = post(url+"/agents/devices", device, {"X-Agent-Key":state["key"]})
        worker = BatchWorker(url,slot["key"],wallet,device)

        def run(w):
            with device_lock(w.capabilities):
                while not w.stopped.is_set():
                    try:
                        w.run()
                    except (requests.RequestException, RuntimeError) as error:
                        print(f"Device session unavailable: {error}", flush=True)
                        w.stopped.wait(5)

        thread = threading.Thread(target=run,args=(worker,),daemon=True)
        thread.start()
        threads.append(thread)
    if not threads:
        raise RuntimeError("No NVIDIA devices detected. Use --cpu-dev for an explicit CPU pilot.")
    for thread in threads:
        thread.join()


if __name__ == "__main__":
    main()
