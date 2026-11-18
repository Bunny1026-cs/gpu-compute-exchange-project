import json
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import patch

import numpy as np
import torch
import matrix_workload as workload


class TestMatrixWorkload(unittest.TestCase):
    def setUp(self):
        self.spec = {"size": 16, "seed": 42, "dtype": "float32", "executionMode": "real_cpu_test"}

    def test_real_cpu_artifact_is_reproducible_and_independently_verified(self):
        with tempfile.TemporaryDirectory() as directory:
            first = Path(directory) / "first.npy"
            second = Path(directory) / "second.npy"
            result = workload.compute(self.spec, first)
            workload.compute(self.spec, second)
            self.assertEqual(first.read_bytes(), second.read_bytes())
            verification = workload.verify(self.spec, first)
            self.assertTrue(verification["verified"])
            self.assertEqual(verification["preview"], np.load(first, allow_pickle=False)[:4, :4].tolist())
            self.assertGreater(result["timingsMs"]["kernel"], 0)
            self.assertGreaterEqual(result["timingsMs"]["capabilityProbe"], 0)
            self.assertGreaterEqual(result["timingsMs"]["libraryImport"], 0)
            self.assertEqual(result["numpyVersion"], np.__version__)
            self.assertIsNone(result["timingsMs"]["hostToDevice"])
            self.assertEqual(np.load(first, allow_pickle=False).shape, (16, 16))

    def test_corrupt_numerical_result_rejected(self):
        with tempfile.TemporaryDirectory() as directory:
            file = Path(directory) / "bad.npy"
            np.save(file, np.zeros((16, 16), dtype="float32"), allow_pickle=False)
            with self.assertRaises(AssertionError):
                workload.verify(self.spec, file)

    def test_nan_and_wrong_shape_rejected(self):
        with tempfile.TemporaryDirectory() as directory:
            file = Path(directory) / "bad.npy"
            for value in [np.full((16, 16), np.nan, dtype="float32"), np.zeros((3, 3), dtype="float32")]:
                np.save(file, value, allow_pickle=False)
                with self.assertRaises(ValueError):
                    workload.verify(self.spec, file)

    def test_real_gpu_never_falls_back(self):
        with patch.object(torch.cuda, "is_available", return_value=False):
            with self.assertRaisesRegex(RuntimeError, "no CPU fallback"):
                workload.capabilities("real_gpu")

    def test_two_workers_cannot_hold_the_same_device_lock(self):
        from runner import device_lock
        device = {"executionMode": "real_gpu", "deviceUuid": "unit-test-device"}
        with device_lock(device):
            with self.assertRaisesRegex(RuntimeError, "Another worker owns"):
                with device_lock(device):
                    self.fail("Second worker acquired the same device")
        with device_lock(device):
            pass  # Reacquisition after the first worker exits.

    def test_unsafe_or_unbounded_spec_rejected(self):
        for change in [{"size": 1000000}, {"size": True}, {"seed": -1}, {"dtype": "object"}, {"executionMode": "simulated"}, {"code": "print(1)"}]:
            with self.subTest(change=change), self.assertRaises(ValueError):
                workload.validate_spec({**self.spec, **change})

    def test_timeout_propagates(self):
        with patch("matrix_workload.subprocess.run", side_effect=subprocess.TimeoutExpired("compute", 1)):
            with self.assertRaises(subprocess.TimeoutExpired):
                workload.execute(self.spec, "unused.npy", 1)

    def test_child_error_propagates(self):
        response = subprocess.CompletedProcess([], 1, json.dumps({"error": "CUDA out of memory"}), "")
        with patch("matrix_workload.subprocess.run", return_value=response):
            with self.assertRaisesRegex(RuntimeError, "out of memory"):
                workload.execute(self.spec, "unused.npy")


if __name__ == "__main__":
    unittest.main()
