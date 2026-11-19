"""Interactive launcher for the two-laptop Windows Hardhat demonstration."""
import hashlib
import ipaddress
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
from urllib.request import Request, urlopen
from urllib.parse import urlsplit


ROOT = Path(__file__).resolve().parent
STATE = ROOT.parent / "runtime" / "paired-agent.json"
VENV = ROOT.parent / "runtime" / "provider-venv"


def private_host(value):
    ip = ipaddress.IPv4Address(value.strip())
    if not any(ip in ipaddress.ip_network(net) for net in ("10.0.0.0/8", "172.16.0.0/12", "192.168.0.0/16")):
        raise ValueError("Enter Laptop 1's private Wi-Fi IPv4 address.")
    return str(ip)


def read_json(request):
    with urlopen(request, timeout=8) as response:
        return json.load(response)


def main():
    os.chdir(ROOT)
    if sys.version_info < (3, 10):
        raise ValueError("Install Python 3.10 or newer.")
    for program in ("node", "npm.cmd", "docker", "nvidia-smi"):
        if not shutil.which(program):
            raise ValueError(f"Missing {program}. Install the corresponding prerequisite and reopen the launcher.")
    subprocess.run(["nvidia-smi", "-L"], check=True)
    if subprocess.check_output(["docker", "info", "--format", "{{.OSType}}"], text=True).strip() != "linux":
        raise ValueError("Start Docker Desktop in Linux container mode using WSL 2.")
    host = private_host(urlsplit(json.loads(STATE.read_text())["url"]).hostname if STATE.exists()
                        else input("Laptop 1 Wi-Fi IPv4 address: "))
    backend = f"http://{host}:5000"
    rpc = f"http://{host}:8545"
    health = read_json(backend + "/health")
    if (health.get("executionMode") != "real_gpu" or health.get("database", {}).get("status") != "connected"
            or not health.get("blockchain", {}).get("available")):
        raise ValueError("Start the Laptop 1 backend in real_gpu mode with MongoDB and escrow connected.")
    request = Request(rpc, json.dumps({"jsonrpc": "2.0", "id": 1, "method": "hardhat_metadata", "params": []}).encode(),
                      {"Content-Type": "application/json"})
    if read_json(request).get("result", {}).get("chainId") != 31337:
        raise ValueError("Laptop 1 must run the local Hardhat demo chain on port 8545.")

    python = VENV / "Scripts" / "python.exe"
    if not python.exists():
        subprocess.run([sys.executable, "-m", "venv", str(VENV)], check=True)
    stamp = VENV / "provider-dependencies.sha256"
    digest = hashlib.sha256((ROOT / "requirements.txt").read_bytes() + (ROOT / "package-lock.json").read_bytes()).hexdigest()
    if not stamp.exists() or stamp.read_text() != digest or not (ROOT / "node_modules/ethers").exists():
        subprocess.run([str(python), "-m", "pip", "install", "-r", "requirements.txt"], check=True)
        subprocess.run(["npm.cmd", "ci"], check=True)
        stamp.write_text(digest)
    image = json.loads((ROOT / "profiles.json").read_text())["pytorch-cuda"]
    if subprocess.run(["docker", "image", "inspect", image], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL).returncode:
        subprocess.run(["docker", "pull", image], check=True)
    inventory = json.loads(subprocess.check_output([str(python), "agent.py", "--discover"], text=True))
    if not any(d.get("testedImage") == image for d in inventory):
        for device in inventory:
            print(device.get("gpuModel"), device.get("probeError"))
        raise ValueError("No GPU passed the CUDA calculation in the pinned job image.")

    # Account 3 is the public Hardhat development identity used by ops/setup-local.cjs.
    # Pass its key to the host signer in memory. It never enters the job container.
    derive = """const { HDNodeWallet } = require('ethers');
const account = HDNodeWallet.fromPhrase('test test test test test test test test test test test junk',
  undefined, "m/44'/60'/0'/0/3"); process.stdout.write(account.privateKey);"""
    key = subprocess.check_output(["node", "-e", derive], text=True)
    env = dict(os.environ, BACKEND_URL=backend + "/api", BLOCKCHAIN_RPC_URL=rpc,
               EXECUTION_MODE="real_gpu", FINAL_DEMO="true", PROVIDER_PRIVATE_KEY=key)
    args = [str(python), "agent.py"]
    if not STATE.exists():
        print(f"Open http://{host}:5173, sign in as Provider and click Pair local agent.")
        args.extend(["--pair", input("Pairing code: ").strip()])
    print("Keep this window open. Enable the GPU and set its rate in the provider dashboard.", flush=True)
    subprocess.run(args, env=env, check=True)


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        pass
    except subprocess.CalledProcessError as exc:
        sys.exit(f"{Path(exc.cmd[0]).name} failed (exit {exc.returncode}). Check the message above.")
    except (OSError, ValueError, KeyError) as exc:
        sys.exit(str(exc))
