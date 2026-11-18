"""Allowlisted, bounded genuine matrix computation and independent artifact verification."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import platform
import subprocess
import sys
import time


def validate_spec(spec):
    if set(spec) != {"size", "seed", "dtype", "executionMode"}:
        raise ValueError("Unexpected workload fields")
    if type(spec["size"]) is not int or not 2 <= spec["size"] <= 1024:
        raise ValueError("Matrix size must be an integer between 2 and 1024")
    if type(spec["seed"]) is not int or not 0 <= spec["seed"] <= 2147483647:
        raise ValueError("Invalid seed")
    if spec["dtype"] != "float32" or spec["executionMode"] not in ("real_gpu", "real_cpu_test"):
        raise ValueError("Only float32 real_gpu or real_cpu_test is allowed")


def inputs(spec):
    import numpy as np
    import torch
    validate_spec(spec)
    # PCG64 explicitly selected: CPU-generated inputs shared with the verifier.
    rng = np.random.Generator(np.random.PCG64(spec["seed"]))
    shape = (spec["size"], spec["size"])
    return (torch.from_numpy(rng.uniform(-1, 1, shape).astype("float32")),
            torch.from_numpy(rng.uniform(-1, 1, shape).astype("float32")))


def capabilities(mode):
    import torch
    if mode not in ("real_gpu", "real_cpu_test"):
        raise ValueError("Simulation and implicit CPU fallback are forbidden")
    report = {"executionMode": mode, "python": platform.python_version(),
              "torch": torch.__version__, "os": platform.platform(), "cudaVersion": "0"}
    if mode == "real_gpu":
        if not torch.cuda.is_available():
            raise RuntimeError("real_gpu requires working CUDA; no CPU fallback")
        index = int(os.getenv("CUDA_DEVICE_INDEX", "0"))
        torch.cuda.set_device(index)
        prop = torch.cuda.get_device_properties(index)
        # Actually launch a kernel to reject unsupported architectures early.
        actual = (torch.tensor([[1., 2.], [3., 4.]], device="cuda") @
                  torch.tensor([[5., 6.], [7., 8.]], device="cuda")).cpu()
        torch.testing.assert_close(actual, torch.tensor([[19., 22.], [43., 50.]]), rtol=0, atol=0)
        report.update(gpuModel=prop.name, gpuMemory=prop.total_memory / 1024**3,
                      cudaVersion=torch.version.cuda, deviceIndex=index,
                      computeCapability=list(torch.cuda.get_device_capability(index)),
                      compiledArchitectures=torch.cuda.get_arch_list())
    else:
        report.update(gpuModel="CPU development test (not a GPU)", gpuMemory=0, deviceIndex=None)
    return report


def compute(spec, output):
    import numpy as np
    import torch
    validate_spec(spec)
    started = time.perf_counter()
    cap = capabilities(spec["executionMode"])
    torch.set_num_threads(max(1, min(4, os.cpu_count() or 1)))
    torch.backends.cuda.matmul.allow_tf32 = False
    a, b = inputs(spec)
    t = time.perf_counter()
    reference = a.double() @ b.double()
    cpu_reference_ms = (time.perf_counter() - t) * 1000
    gpu = spec["executionMode"] == "real_gpu"
    warm = time.perf_counter()
    if gpu:
        wa, wb = a.cuda(), b.cuda()
        for _ in range(3):
            wc = wa @ wb
        torch.cuda.synchronize()
        del wa, wb, wc
        torch.cuda.reset_peak_memory_stats()
    else:
        for _ in range(3):
            _ = a @ b
    warmup_ms = (time.perf_counter() - warm) * 1000
    # Identical float32 CPU workload for an honest future CPU/GPU comparison.
    for _ in range(3):
        _ = a @ b
    baseline_start = time.perf_counter()
    _ = a @ b
    cpu_float32_ms = (time.perf_counter() - baseline_start) * 1000
    def measure(fn):
        if gpu:
            torch.cuda.synchronize()
        t0 = time.perf_counter()
        value = fn()
        if gpu:
            torch.cuda.synchronize()
        return value, (time.perf_counter() - t0) * 1000
    if gpu:
        (ga, gb), h2d = measure(lambda: (a.cuda(), b.cuda()))
        result, kernel = measure(lambda: ga @ gb)
        result, d2h = measure(lambda: result.cpu())
    else:
        result, kernel = measure(lambda: a @ b)
        h2d = d2h = None
    torch.testing.assert_close(result.double(), reference, rtol=1e-4, atol=1e-4)
    output = Path(output)
    with output.open("wb") as stream:
        np.save(stream, result.numpy(), allow_pickle=False)
    return {"status": "success", "capabilities": cap, "spec": spec,
            "sha256": hashlib.sha256(output.read_bytes()).hexdigest(),
            "artifactBytes": output.stat().st_size, "verified": True,
            "maxAbsoluteError": (result.double() - reference).abs().max().item(),
            "timingsMs": {"warmup": warmup_ms, "hostToDevice": h2d,
                          "kernel": kernel, "deviceToHost": d2h,
                          "cpuFloat64Reference": cpu_reference_ms,
                          "cpuFloat32Kernel": cpu_float32_ms,
                          "total": (time.perf_counter() - started) * 1000},
            "peakAllocatedBytes": torch.cuda.max_memory_allocated() if gpu else None,
            "peakReservedBytes": torch.cuda.max_memory_reserved() if gpu else None,
            "timingMethod": "synchronized host monotonic clock; warm execution; transfers separate"}


def verify(spec, artifact):
    import numpy as np
    import torch
    validate_spec(spec)
    torch.set_num_threads(max(1, min(4, os.cpu_count() or 1)))
    if Path(artifact).stat().st_size > 1024 * 1024 * 4 + 4096:
        raise ValueError("Oversize artifact")
    with open(artifact, "rb") as stream:
        version = np.lib.format.read_magic(stream)
        if version != (1, 0):
            raise ValueError("Only bounded NumPy v1 float32 arrays are accepted")
        shape, fortran, dtype = np.lib.format.read_array_header_1_0(stream, max_header_size=4096)
        if shape != (spec["size"], spec["size"]) or fortran or dtype != np.dtype("float32"):
            raise ValueError("Artifact header does not match funded specification")
        if Path(artifact).stat().st_size != stream.tell() + spec["size"] ** 2 * 4:
            raise ValueError("Artifact byte length does not match dimensions")
    value = np.load(artifact, allow_pickle=False)
    if value.dtype != np.dtype("float32") or value.shape != (spec["size"], spec["size"]):
        raise ValueError("Artifact shape/dtype does not match funded specification")
    if not np.isfinite(value).all():
        raise ValueError("Non-finite result")
    a, b = inputs(spec)
    reference = a.double() @ b.double()
    actual = torch.from_numpy(value).double()
    torch.testing.assert_close(actual, reference, rtol=1e-4, atol=1e-4)
    return {"verified": True, "maxAbsoluteError": (actual - reference).abs().max().item(),
            "rtol": 1e-4, "atol": 1e-4}


def execute(spec, output, timeout=120):
    validate_spec(spec)
    result = subprocess.run([sys.executable, str(Path(__file__).resolve()), "compute",
                             "--spec", json.dumps(spec), "--artifact", str(output)],
                            capture_output=True, text=True, timeout=timeout, check=False)
    if result.returncode:
        raise RuntimeError(result.stdout or result.stderr)
    return json.loads(result.stdout)


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("action", choices=["compute", "verify", "capabilities"])
    parser.add_argument("--spec")
    parser.add_argument("--artifact")
    parser.add_argument("--mode", default="real_gpu")
    args = parser.parse_args()
    try:
        if args.action == "capabilities":
            data = capabilities(args.mode)
        else:
            data = (compute if args.action == "compute" else verify)(json.loads(args.spec), args.artifact)
        print(json.dumps(data))
    except Exception as error:
        print(json.dumps({"status": "error", "error": f"{type(error).__name__}: {error}"}))
        sys.exit(1)
