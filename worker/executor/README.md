# GPU Worker — Executor

This module handles the **actual GPU job execution** using Python and Docker.

The active demo executor lives one directory up in `worker/executor.py`. It
simulates GPU work and returns deterministic-format result payloads; this
directory is reserved for a future real Docker/NVIDIA executor.

## Planned Responsibilities

- Receive a job payload from the job-runner
- Spin up an isolated Docker container with the correct CUDA image
- Mount user-submitted ML scripts/data
- Execute the computation
- Capture output / results
- Push results to IPFS
- Report status back to the backend

## Planned Tech Stack

- **Language**: Python 3.10+
- **GPU Access**: NVIDIA Container Toolkit (`--runtime=nvidia`)
- **Base Images**: `nvidia/cuda:12.x-runtime-ubuntu22.04`
- **IPFS Client**: `ipfshttpclient` or `requests` to a local IPFS node

## Directory Structure (planned)

```
executor/
├── executor.py       # Core execution logic
├── docker_runner.py  # Docker API wrapper
├── ipfs_uploader.py  # IPFS upload helper
└── utils.py          # Logging, validation
```
