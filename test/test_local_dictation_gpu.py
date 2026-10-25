"""Unit tests for GPU mutex and sampling logic in scripts/local-dictation.py."""

import importlib.util
import os
import sys
import unittest
from unittest.mock import MagicMock, patch

SPEC = importlib.util.spec_from_file_location(
    "local_dictation",
    os.path.join(os.path.dirname(__file__), "..", "scripts", "local-dictation.py")
)
ld = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(ld)


class TestWindowsGpuMutex(unittest.TestCase):
    def test_acquire_success(self):
        k32 = MagicMock()
        k32.CreateMutexW.return_value = 1001
        k32.WaitForSingleObject.return_value = ld.WAIT_OBJECT_0

        mutex = ld.WindowsGpuMutex(name="TestMutex", kernel32=k32)
        acquired = mutex.acquire(timeout_ms=0)

        self.assertTrue(acquired)
        self.assertTrue(mutex.acquired)
        self.assertEqual(mutex.handle, 1001)
        k32.CreateMutexW.assert_called_once_with(None, False, "TestMutex")
        k32.WaitForSingleObject.assert_called_once_with(1001, 0)

    def test_acquire_timeout(self):
        k32 = MagicMock()
        k32.CreateMutexW.return_value = 1002
        k32.WaitForSingleObject.return_value = 0x00000102

        mutex = ld.WindowsGpuMutex(name="TestMutex", kernel32=k32)
        acquired = mutex.acquire(timeout_ms=0)

        self.assertFalse(acquired)
        self.assertFalse(mutex.acquired)
        self.assertIsNone(mutex.handle)
        k32.CloseHandle.assert_called_once_with(1002)

    def test_acquire_abandoned(self):
        k32 = MagicMock()
        k32.CreateMutexW.return_value = 1003
        k32.WaitForSingleObject.return_value = ld.WAIT_ABANDONED

        mutex = ld.WindowsGpuMutex(name="TestMutex", kernel32=k32)
        acquired = mutex.acquire(timeout_ms=0)

        self.assertTrue(acquired)
        self.assertTrue(mutex.acquired)
        self.assertEqual(mutex.handle, 1003)

    def test_release(self):
        k32 = MagicMock()
        k32.CreateMutexW.return_value = 1004
        k32.WaitForSingleObject.return_value = ld.WAIT_OBJECT_0

        mutex = ld.WindowsGpuMutex(name="TestMutex", kernel32=k32)
        mutex.acquire(timeout_ms=0)
        mutex.release()

        self.assertFalse(mutex.acquired)
        self.assertIsNone(mutex.handle)
        k32.ReleaseMutex.assert_called_once_with(1004)
        k32.CloseHandle.assert_called_once_with(1004)


class TestGpuSamplingAndThresholds(unittest.TestCase):
    def test_query_gpu_sample_success(self):
        mock_cmd = MagicMock(return_value="35, 6200\n")
        util, free_mb = ld.query_gpu_sample(run_cmd=mock_cmd)
        self.assertEqual(util, 35)
        self.assertEqual(free_mb, 6200)

    def test_query_gpu_sample_invalid_format(self):
        mock_cmd = MagicMock(return_value="invalid")
        with self.assertRaises(ValueError):
            ld.query_gpu_sample(run_cmd=mock_cmd)

    def test_sample_gpu_load_takes_3_samples(self):
        samples_in = [(10, 5000), (12, 4900), (15, 4800)]
        idx = [0]
        def query_fn():
            s = samples_in[idx[0]]
            idx[0] += 1
            return s
        sleep_calls = []
        samples_out = ld.sample_gpu_load(query_fn=query_fn, sleep_fn=lambda s: sleep_calls.append(s))
        self.assertEqual(samples_out, samples_in)
        self.assertEqual(len(sleep_calls), 2)

    def test_high_utilization_falls_back_to_cpu(self):
        # 2 of 3 >= 70%
        samples = [(72, 8000), (70, 8000), (10, 8000)]
        self.assertIsNone(ld.evaluate_gpu_compute_type(samples))

        # 3 of 3 >= 70%
        samples = [(80, 8000), (85, 8000), (75, 8000)]
        self.assertIsNone(ld.evaluate_gpu_compute_type(samples))

        # Only 1 of 3 >= 70% -> allowed to use GPU if memory suffices
        samples = [(75, 5000), (40, 5000), (30, 5000)]
        self.assertEqual(ld.evaluate_gpu_compute_type(samples), "float16")

    def test_memory_thresholds(self):
        # >= 4500 -> float16
        self.assertEqual(ld.evaluate_gpu_compute_type([(10, 5000), (10, 4600), (10, 4500)]), "float16")

        # >= 2500, < 4500 -> int8_float16
        self.assertEqual(ld.evaluate_gpu_compute_type([(10, 5000), (10, 3000), (10, 2500)]), "int8_float16")

        # < 2500 -> None (fallback to CPU)
        self.assertIsNone(ld.evaluate_gpu_compute_type([(10, 5000), (10, 3000), (10, 2499)]))

    def test_gpu_compute_type_query_failure_returns_none(self):
        def failing_query():
            raise RuntimeError("nvidia-smi error")
        self.assertIsNone(ld.gpu_compute_type(query_fn=failing_query, sleep_fn=lambda _: None))


class TestModelLoadFallback(unittest.TestCase):
    def test_load_model_device_kwargs(self):
        # Mock faster_whisper WhisperModel to verify kwargs without loading real model
        with patch.dict("sys.modules", {"faster_whisper": MagicMock()}):
            import faster_whisper
            mock_cls = faster_whisper.WhisperModel

            # CPU
            ld.load_model("cpu", "int8")
            mock_cls.assert_called_with(
                ld.MODEL,
                device="cpu",
                compute_type="int8",
                local_files_only=True,
                cpu_threads=8
            )

            # CUDA
            ld.load_model("cuda", "float16")
            mock_cls.assert_called_with(
                ld.MODEL,
                device="cuda",
                compute_type="float16",
                local_files_only=True
            )


if __name__ == "__main__":
    unittest.main()
