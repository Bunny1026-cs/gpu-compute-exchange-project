# Genuine local performance results

## November 18 CPU rehearsal

Five fresh 128×128 jobs used Kubo, local MongoDB and Hardhat. The client measured
from submission until observing completed payment. The worker measured upload
through receipt of the backend verification response. All durations below are ms.

| Measurement | Samples | Minimum | Median | Maximum |
| --- | ---: | ---: | ---: | ---: |
| Submission through observed payment | 5 | 14008.346 | 17018.953 | 19420.430 |
| Queue wait | 5 | 70.809 | 1727.646 | 2446.661 |
| Scheduling through confirmed assignment | 5 | 457.823 | 486.938 | 495.526 |
| Upload and verification round trip | 5 | 4448.754 | 4690.272 | 5785.202 |
| Warm CPU kernel, 128×128 | 10 | 0.024 | 0.036 | 0.108 |
| Warm CPU kernel, 256×256 | 10 | 0.128 | 0.209 | 0.658 |
| Warm CPU kernel, 512×512 | 10 | 1.540 | 2.187 | 3.565 |

Windows 11, Python 3.13.7, PyTorch 2.12.1+cpu, float32. Local services and some
acceptance checks were active during compute sampling. These figures describe a
development laptop under that load. The raw reports include transfer timings,
per-action gas, and local receipt observation times where observed. Samples
reference the working tree based on commit 165b01e. [Application measurements](evidence/rehearsal-20261118/kubo/application-summary.json) · [Compute samples](evidence/rehearsal-20261118/compute/raw.json)

## Earlier CPU rehearsal

All results here are **Laptop 1 real_cpu_test**, not GPU performance. Environment:
Windows 11 x64, Python 3.13.7, PyTorch 2.12.1+cpu. Float32 matrices are generated
with NumPy PCG64 seed; correctness uses a float64 CPU reference, rtol/atol 1e-4.
Cold process imports and warmup are separate from kernel measurements.

## Five complete application runs

Source: `evidence/cpu-integration.json` and derived CSV. Matrix size 128×128;
seeds 42–46. Real local MongoDB, HTTP worker, artifact upload and independent
verification, local Hardhat funding, provider submission and payment were included.

| Metric | Count | Minimum | Median | Maximum |
| --- | ---: | ---: | ---: | ---: |
| End-to-end CPU application time (ms) | 5 | 17403.837 | 17438.392 | 20516.135 |

The monotonic clock runs in the integration client on Laptop 1. This includes
polling and retry-observation overhead. It is not a two-machine network latency
measurement. Earlier pre-fix runs are retained separately, not pooled into these results.

Every run released 1000000000000000 wei, read from the local PaymentReleased event.
Example first latest payment transaction:
`0x4c7573740354e99952c783351281d2907a1b71c42e6c93aac2bcca3f802e0393`.

Example actual gas measurements from that run:

| Confirmed action | Gas used |
| --- | ---: |
| JobRegistered | 97092 |
| FundsDeposited | 53319 |
| JobAssigned | 56010 |
| ResultSubmitted | 53844 |
| ResultVerified | 33401 |
| PaymentReleased | 54263 |

These are local-development contract gas measurements. No public-network confirmation
time, monetary savings, cloud price comparison or GPU speedup is claimed.

## Ten warm CPU samples

`evidence/cpu-benchmark-final/raw.json` contains ten completed 128×128 samples,
with explicit mode, environment, Git identifier at collection and full timing fields.
`samples.csv`, `summary.json`, and `kernel-times.png` are derived from those bytes.
These samples were collected during implementation, with uncommitted code present;
their embedded Git identifier identifies the base commit, not a pristine checkout.

| Dimension | Count | Minimum ms | Median ms | Maximum ms |
| --- | ---: | ---: | ---: | ---: |
| 128×128 float32 CPU | 10 | 0.029600 | 0.043600 | 1.387400 |

The outlier is retained. Processes perform warmups, then use a monotonic host clock.
These tiny matrices are sensitive to OS scheduling and cannot establish GPU benefit.
The planned 256/512 benchmark was interrupted; it is not reported as completed.

## GPU evaluation to run later

Use `worker/benchmark.py --mode real_gpu --sizes 128 256 512 --runs 10` on Laptop 2.
It fails on unavailable CUDA. Record actual GPU/driver/OS, AC power settings, NumPy,
PyTorch/CUDA, Git commit and supported telemetry. Each sample records synchronized
warm kernel time, separate H2D/D2H wall times, peak allocated/reserved device memory,
same-input float32 CPU kernel and float64 correctness reference timings. Warmup and
total subprocess costs remain distinct. A fresh child per sample measures warm
kernels but repeats process/CUDA cold-start overhead outside those kernel timings.

Run five complete GPU application jobs and retain each artifact and receipt. Compare
identical dimensions/dtypes/inputs; report all raw samples and median/min/max. Capture
supported utilization telemetry on Laptop 2 separately. Never subtract wall-clock
timestamps across machines without synchronization. No GPU or cross-laptop values
are filled in until those measurements actually exist.

### Collection commands for the current source revision

On Laptop 2 use AC power, record the power profile, keep the GPU free of other
jobs during compute-only measurements, and run from the project root:

```powershell
worker/.venv/Scripts/python.exe -m pip install "matplotlib>=3.9"
worker/.venv/Scripts/python.exe worker/benchmark.py --mode real_gpu --sizes 128 256 512 --runs 10 --output evidence/gpu-benchmark
```

The raw report includes import, capability-probe, warmup, child-process and kernel
durations. NVIDIA telemetry samples the selected UUID across the child's lifetime,
including startup. Utilization is device-wide. An empty telemetry series or an
unavailable reading is missing data. Save the driver information from preflight too.

With the GPU worker running and the demo accounts provisioned, on Laptop 1:

```powershell
$env:EVIDENCE_DIR = Join-Path $PWD ("evidence/gpu-application-" + (Get-Date -Format yyyyMMdd-HHmmss))
node ops/integration.cjs 5 real_gpu 128
python -m pip install "matplotlib>=3.9"
python ops/summarize-runs.py "$env:EVIDENCE_DIR/gpu-integration.json"
```

Copy the matching `worker/results/*.timing.json` files from Laptop 2 to a folder
on Laptop 1, then include its path to join provider-signed receipt timings and
upload round trips by job ID and transaction hash:

```powershell
python ops/summarize-runs.py "$env:EVIDENCE_DIR/gpu-integration.json" --worker-results "$env:EVIDENCE_DIR/worker-timings"
```

Queue wait ends when the successful scheduling attempt begins. It is omitted if
the backend restarted between funding and assignment. Scheduling includes on-chain
assignment. Receive time covers backend HTTP body consumption. Worker upload time
includes verification and the HTTP response. Client download time includes retrieval.
End-to-end time ends when the client observes COMPLETED, before artifact download and
retry checks. Receipt time is elapsed on the submitting process through receipt
observation on local Hardhat. Recovered historical receipts can lack that measurement.
The CSV, summary JSON and plot use measured observations only.
