"""Export application measurements, optionally joining the worker's per-job files."""
import argparse
import csv
import json
from pathlib import Path
from statistics import median


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("report", type=Path)
    parser.add_argument("--worker-results", type=Path)
    args = parser.parse_args()
    runs = json.loads(args.report.read_text(encoding="utf-8"))["samples"]
    rows = []
    for run in runs:
        job_id = run["jobId"]
        timing = {}
        if args.worker_results:
            file = args.worker_results / (job_id + ".timing.json")
            if file.is_file():
                timing = json.loads(file.read_text(encoding="utf-8"))
                if timing["jobId"] != job_id:
                    raise ValueError("Worker timing file belongs to another job")
        metrics = {key: run.get(key) for key in
                   ("endToEndMs", "downloadMs", "receiveMs", "queueWaitMs", "schedulingMs")}
        metrics["uploadAndVerifyMs"] = timing.get("uploadAndVerifyMs")
        for receipt in run["receipts"]:
            event = receipt["action"]
            metrics[event + ".gas"] = int(receipt["gasUsed"])
            provider = timing.get("providerReceipt", {})
            metrics[event + ".confirmationMs"] = (provider["confirmationMs"]
                if provider.get("txHash") == receipt["txHash"] else receipt.get("confirmationMs"))
        for key, value in metrics.items():
            if value is not None:
                rows.append((job_id, key, value))
    directory = args.report.parent
    with (directory / "application-samples.csv").open("w", newline="", encoding="utf-8") as stream:
        writer = csv.writer(stream)
        writer.writerow(["jobId", "metric", "value"])
        writer.writerows(rows)
    summary = {}
    for key in sorted({row[1] for row in rows}):
        values = [value for _, metric, value in rows if metric == key]
        summary[key] = dict(count=len(values), minimum=min(values), median=median(values), maximum=max(values))
    (directory / "application-summary.json").write_text(json.dumps(summary, indent=2), encoding="utf-8")
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    fig, axis = plt.subplots()
    axis.plot(range(1, len(runs) + 1), [run["endToEndMs"] / 1000 for run in runs], marker="o")
    axis.set(xlabel="Completed job", ylabel="Submission to observed payment (seconds)",
             title=f"{runs[0]['executionMode']} on local Hardhat")
    fig.tight_layout()
    fig.savefig(directory / "application-times.png")
    plt.close(fig)


if __name__ == "__main__":
    main()
