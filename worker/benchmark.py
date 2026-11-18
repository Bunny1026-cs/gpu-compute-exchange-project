"""Collect raw warm compute samples. Never substitutes CPU for a GPU run."""
import argparse
import csv
import json
from pathlib import Path
import statistics
import subprocess
import tempfile

from matrix_workload import execute


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--mode", choices=["real_gpu", "real_cpu_test"], default="real_gpu")
    parser.add_argument("--sizes", nargs="+", type=int, default=[128, 256, 512])
    parser.add_argument("--runs", type=int, default=10)
    parser.add_argument("--output", type=Path, default=Path("evidence/benchmark"))
    args = parser.parse_args()
    if args.runs < 10:
        parser.error("At least 10 warm samples per size are required")
    args.output.mkdir(parents=True, exist_ok=True)
    commit = subprocess.run(["git", "rev-parse", "HEAD"], capture_output=True, text=True, check=False).stdout.strip()
    samples = []
    with tempfile.TemporaryDirectory() as directory:
        for size in args.sizes:
            for index in range(args.runs):
                spec = {"size": size, "seed": 42, "dtype": "float32", "executionMode": args.mode}
                result = execute(spec, Path(directory) / "result.npy")
                result.update(sample=index, gitCommit=commit)
                samples.append(result)
                (args.output / "raw.json").write_text(json.dumps(samples, indent=2), encoding="utf-8")
                print(f"{args.mode}: size={size}, sample={index+1}, kernel_ms={result['timingsMs']['kernel']:.6f}", flush=True)
    fields = ["mode", "size", "sample", "kernelMs", "cpuFloat32Ms", "hostToDeviceMs", "deviceToHostMs", "peakAllocatedBytes"]
    with (args.output / "samples.csv").open("w", newline="", encoding="utf-8") as stream:
        writer = csv.DictWriter(stream, fieldnames=fields)
        writer.writeheader()
        for sample in samples:
            writer.writerow(dict(zip(fields, [args.mode, sample["spec"]["size"], sample["sample"],
                sample["timingsMs"]["kernel"], sample["timingsMs"]["cpuFloat32Kernel"],
                sample["timingsMs"]["hostToDevice"], sample["timingsMs"]["deviceToHost"], sample["peakAllocatedBytes"]])))
    summary = []
    for size in args.sizes:
        values = [sample["timingsMs"]["kernel"] for sample in samples if sample["spec"]["size"] == size]
        summary.append({"size": size, "count": len(values), "medianMs": statistics.median(values), "minMs": min(values), "maxMs": max(values)})
    (args.output / "summary.json").write_text(json.dumps(summary, indent=2), encoding="utf-8")
    try:
        import matplotlib
        matplotlib.use("Agg")
        import matplotlib.pyplot as plt
        fig, axis = plt.subplots(figsize=(7, 4))
        axis.boxplot([[sample["timingsMs"]["kernel"] for sample in samples if sample["spec"]["size"] == size] for size in args.sizes], tick_labels=[str(size) for size in args.sizes])
        axis.set(xlabel="Square matrix dimension (float32)", ylabel="Warm kernel wall time (ms)", title=f"BDGCE {args.mode}: actual samples (n={args.runs}/size)")
        fig.tight_layout()
        fig.savefig(args.output / "kernel-times.png", dpi=160)
        plt.close(fig)
    except ImportError:
        print("Chart not generated: install matplotlib; CSV/JSON are available")


if __name__ == "__main__":
    main()
