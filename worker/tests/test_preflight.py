"""Diagnostics tests use mocks, not evidence of physical CUDA execution."""

import io
import json
import subprocess
import unittest
from unittest.mock import patch

import preflight


class TestPreflight(unittest.TestCase):
    def test_cuda_timeout_is_failure(self):
        with patch("preflight.subprocess.run", side_effect=subprocess.TimeoutExpired("probe", 60)):
            self.assertEqual(preflight.run_cuda_probe()["status"], "failed")

    def test_cuda_crash_is_failure(self):
        with patch("preflight.subprocess.run", return_value=subprocess.CompletedProcess([], 1, "", "crashed")):
            self.assertEqual(preflight.run_cuda_probe()["status"], "failed")

    def test_invalid_child_json_is_failure(self):
        with patch("preflight.subprocess.run", return_value=subprocess.CompletedProcess([], 0, "not JSON", "")):
            self.assertEqual(preflight.run_cuda_probe()["status"], "failed")

    def test_cpu_only_child_stays_failed(self):
        payload = {"status": "failed", "cuda_available": False}
        with patch("preflight.subprocess.run", return_value=subprocess.CompletedProcess([], 0, json.dumps(payload), "")):
            self.assertEqual(preflight.run_cuda_probe(), payload)

    def test_backend_refuses_api_path_and_credentials(self):
        for url in ("file:///tmp/health", "http://host:5000/api", "http://user:pass@host:5000"):
            with self.subTest(url=url):
                self.assertEqual(preflight.check_backend(url)["status"], "failed")

    def test_unrelated_server_is_not_accepted(self):
        with patch("preflight.build_opener") as opener:
            opener.return_value.open.return_value = io.BytesIO(b'{"status":"ok"}')
            self.assertEqual(preflight.check_backend("http://localhost:5000")["status"], "failed")

    def test_http_success_does_not_claim_database_readiness(self):
        payload = {"status": "ok", "service": "gpu-compute-exchange-backend",
                   "database": {"status": "disconnected"}}
        with patch("preflight.build_opener") as opener:
            opener.return_value.open.return_value = io.BytesIO(json.dumps(payload).encode())
            report = preflight.check_backend("http://localhost:5000")
        self.assertEqual(report["status"], "passed")
        self.assertEqual(report["health"]["database"]["status"], "disconnected")


if __name__ == "__main__":
    unittest.main()
