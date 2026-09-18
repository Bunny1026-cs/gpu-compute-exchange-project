# GPU Worker — Job Runner

This module handles **job polling, lifecycle management, and status reporting**.

The active implementation lives one directory up in `worker/runner.py` and
uses REST polling. This directory is reserved for a future split into a
separate queue client package.

## Planned Responsibilities

- Poll the backend job queue (via Redis/BullMQ) for assigned jobs
- Validate job payloads
- Invoke the `executor` to run the job
- Monitor job progress
- Handle retries and failures
- Report completion/failure status back to the backend

## Planned Tech Stack

- **Language**: Python 3.10+
- **Queue Client**: `redis-py` / `rq` or direct REST polling
- **HTTP Client**: `httpx` or `requests`

## Directory Structure (planned)

```
job-runner/
├── runner.py         # Main polling loop
├── job_schema.py     # Pydantic job payload validation
├── status_reporter.py # Reports status back to backend
└── config.py         # Configuration (env vars)
```
