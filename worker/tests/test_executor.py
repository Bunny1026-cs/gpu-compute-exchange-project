"""
tests/test_executor.py
P1-4: executor null safety and deterministic simulated output.

Run from the worker directory:
    python -m unittest discover -s tests -v
"""

import contextlib
import hashlib
import io
import json
import os
import sys
import unittest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from executor import execute_job  # noqa: E402


def run(job):
    with contextlib.redirect_stdout(io.StringIO()):
        return execute_job(job, min_time=0, max_time=0)


def job(**over):
    base = {"_id": "656000000000000000000001", "taskType": "inference",
            "input": {"model": "resnet50"}, "gpuId": {"gpuModel": "RTX 4090", "gpuMemory": 24}}
    base.update(over)
    return base


class TestDeterminism(unittest.TestCase):
    def test_same_job_same_hash_and_data(self):
        a, b = run(job()), run(job())
        self.assertEqual(a["status"], "success")
        self.assertEqual(a["result_hash"], b["result_hash"])
        self.assertEqual(a["result_data"], b["result_data"])

    def test_every_task_type_is_deterministic(self):
        for t in ["inference", "training", "fine-tuning", "render", "custom"]:
            with self.subTest(task=t):
                self.assertEqual(run(job(taskType=t))["result_hash"], run(job(taskType=t))["result_hash"])

    def test_different_job_or_input_changes_hash(self):
        base = run(job())["result_hash"]
        self.assertNotEqual(base, run(job(_id="656000000000000000000002"))["result_hash"])
        self.assertNotEqual(base, run(job(input={"model": "vit"}))["result_hash"])

    def test_hash_is_sha256_of_submitted_result_data(self):
        r = run(job())
        expected = hashlib.sha256(json.dumps(r["result_data"], sort_keys=True).encode("utf-8")).hexdigest()
        self.assertEqual(r["result_hash"], expected)

    def test_wall_clock_time_is_not_part_of_hashed_data(self):
        r = run(job())
        self.assertNotIn("completedAt", r["result_data"])
        self.assertTrue(r["completed_at"].endswith("Z"))


class TestNullSafety(unittest.TestCase):
    def test_input_none_for_every_task_type(self):
        for t in ["inference", "training", "fine-tuning", "render", "custom"]:
            with self.subTest(task=t):
                r = run(job(taskType=t, input=None))
                self.assertEqual(r["status"], "success", r["error"])

    def test_gpu_none_does_not_raise(self):
        r = run(job(gpuId=None))
        self.assertEqual(r["status"], "success", r["error"])
        self.assertEqual(r["result_data"]["gpu"], {"model": "Unknown", "memory": 0})

    def test_missing_task_type_defaults_to_inference(self):
        r = run(job(taskType=None))
        self.assertEqual(r["result_data"]["taskType"], "inference")

    def test_non_dict_input_is_ignored_safely(self):
        self.assertEqual(run(job(input="raw string"))["status"], "success")

    def test_numeric_string_epochs(self):
        r = run(job(taskType="training", input={"epochs": "3"}))
        self.assertEqual(r["status"], "success", r["error"])
        self.assertEqual(len(r["result_data"]["output"]["history"]), 3)


if __name__ == "__main__":
    unittest.main()
