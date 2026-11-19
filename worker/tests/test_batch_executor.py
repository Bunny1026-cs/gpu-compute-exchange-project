import unittest
from unittest.mock import patch

import batch_executor as executor


class PairedDeviceTests(unittest.TestCase):
    def test_discovery_keeps_failed_gpu_visible_without_cuda_readiness(self):
        inventory = "GPU-fixture1, Fixture A, 4096, fixture-driver\nGPU-fixture2, Fixture B, 8192, fixture-driver"
        tested = {"testedImage": executor.PROFILES["pytorch-cuda"], "runtime": "fixture"}
        with patch.object(executor.subprocess, "check_output", return_value=inventory), \
             patch.object(executor, "probe", side_effect=[tested, RuntimeError("fixture probe failure")]):
            first, second = executor.discover(False)
        self.assertEqual(first["gpuMemory"], 4)
        self.assertEqual(first["driver"], "fixture-driver")
        self.assertIn("device=GPU-fixture1", executor.limits(first))
        self.assertIn("device=GPU-fixture2", executor.limits(second))
        self.assertIsNone(second["testedImage"])
        self.assertEqual(second["probeError"], "fixture probe failure")

    def test_cpu_requires_opt_in_and_has_no_gpu_flag(self):
        with patch.object(executor.subprocess, "check_output", side_effect=FileNotFoundError), \
             patch.object(executor, "probe", return_value={"testedImage": executor.PROFILES["python-cpu"]}):
            self.assertEqual(executor.discover(False), [])
            device, = executor.discover(True)
        flags = executor.limits(device)
        for flag in ["--network=none", "--user=65534:65534", "--read-only", "--cap-drop=ALL", "--pull=never"]:
            self.assertIn(flag, flags)
        self.assertNotIn("--gpus", flags)
