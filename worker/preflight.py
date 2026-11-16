"""Read-only Milestone 1 diagnostics; never polls jobs or falls back to CPU.

Run from either laptop: python worker/preflight.py --backend-url http://LAN-IP:5000
The fixed CUDA known-answer check runs in a child process with a timeout.
"""

import argparse
import json
import platform
from pathlib import Path
import subprocess
import sys
from urllib.request import ProxyHandler, build_opener
from urllib.parse import urlsplit


def cuda_probe():
    report = {"status": "failed", "python": sys.version, "os": platform.platform()}
    try:
        import torch

        report.update(torch_version=torch.__version__, torch_cuda=torch.version.cuda,
                      cuda_available=torch.cuda.is_available(),
                      compiled_architectures=torch.cuda.get_arch_list())
        if not report["cuda_available"]:
            raise RuntimeError("CUDA unavailable; a physical compatible NVIDIA GPU and CUDA PyTorch build are required")
        report["devices"] = []
        for index in range(torch.cuda.device_count()):
            props = torch.cuda.get_device_properties(index)
            device = {"index": index, "name": props.name,
                      "total_memory_bytes": props.total_memory,
                      "compute_capability": list(torch.cuda.get_device_capability(index))}
            report["devices"].append(device)
            # Small integers have exactly representable float32 products/sums.
            a = torch.tensor([[1., 2.], [3., 4.]], dtype=torch.float32)
            b = torch.tensor([[5., 6.], [7., 8.]], dtype=torch.float32)
            expected = torch.tensor([[19., 22.], [43., 50.]], dtype=torch.float32)
            ga, gb = a.to(f"cuda:{index}"), b.to(f"cuda:{index}")
            result = ga @ gb
            torch.cuda.synchronize(index)
            actual = result.cpu()
            device["actual_result"] = actual.tolist()
            device["result_device"] = str(result.device)
            torch.testing.assert_close(actual, expected, rtol=0, atol=0)
            torch.testing.assert_close(actual, a @ b, rtol=0, atol=0)
            device["known_answer_passed"] = True
        if not report["devices"]:
            raise RuntimeError("No CUDA devices detected")
        report["status"] = "passed"
    except Exception as exc:
        report["error"] = f"{type(exc).__name__}: {exc}"
    return report


def run_cuda_probe(timeout=60):
    try:
        result = subprocess.run([sys.executable, str(Path(__file__).resolve()), "--cuda-child"],
                                capture_output=True, text=True, timeout=timeout, check=False)
        if result.returncode != 0:
            return {"status": "failed", "error": result.stderr or result.stdout}
        return json.loads(result.stdout)
    except (subprocess.TimeoutExpired, OSError, ValueError) as exc:
        return {"status": "failed", "error": f"{type(exc).__name__}: {exc}"}


def check_backend(url):
    try:
        parsed = urlsplit(url)
        if parsed.scheme not in ("http", "https") or not parsed.hostname or parsed.username or parsed.password:
            raise ValueError("Use an HTTP(S) backend origin without credentials")
        if parsed.path not in ("", "/") or parsed.query or parsed.fragment:
            raise ValueError("Use the backend origin, e.g. http://192.168.0.122:5000 (no /api)")
        # A LAN check must connect directly, not through a configured HTTP proxy.
        with build_opener(ProxyHandler({})).open(url.rstrip("/") + "/health", timeout=10) as response:
            data = json.load(response)
        if data.get("service") != "gpu-compute-exchange-backend" or data.get("status") != "ok":
            raise ValueError("Response is not the BDGCE backend health endpoint")
        return {"status": "passed", "url": url, "health": data,
                "note": "HTTP reachability only; inspect database and blockchain separately"}
    except Exception as exc:
        return {"status": "failed", "url": url, "error": f"{type(exc).__name__}: {exc}"}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--backend-url")
    parser.add_argument("--output", type=Path)
    parser.add_argument("--cuda-child", action="store_true", help=argparse.SUPPRESS)
    args = parser.parse_args()
    if args.cuda_child:
        print(json.dumps(cuda_probe()))
        return 0
    report = {"os": platform.platform(), "python": sys.version, "cuda": run_cuda_probe()}
    try:
        smi = subprocess.run(["nvidia-smi", "--query-gpu=name,memory.total,driver_version",
                              "--format=csv"], capture_output=True, text=True, timeout=15, check=False)
        report["nvidia_smi"] = {"exit_code": smi.returncode, "stdout": smi.stdout, "stderr": smi.stderr}
    except (OSError, subprocess.TimeoutExpired) as exc:
        report["nvidia_smi"] = {"error": str(exc)}
    report["backend"] = check_backend(args.backend_url) if args.backend_url else {"status": "not_checked"}
    payload = json.dumps(report, indent=2)
    if args.output:
        args.output.write_text(payload + "\n", encoding="utf-8")
    print(payload)
    return 0 if report["cuda"]["status"] == "passed" and report["backend"]["status"] != "failed" else 1


if __name__ == "__main__":
    sys.exit(main())
