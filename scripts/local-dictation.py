"""One-shot, stdin-only offline transcription helper for K."""

import ctypes
import gc
import io
import json
import os
import subprocess
import sys
import time
import wave

MODEL = os.environ.get("K_DICTATION_MODEL")
MAX_SECONDS = 5 * 60
SAMPLE_RATE = 16_000
# Dictation takes the fastest option that fits in free GPU memory and leaves the rest to other GPU
# work: float16 loads fastest (about 3.9 GB), int8 needs about 2 GB but loads about 2 s slower, and
# below that the CPU is slower still but keeps dictation working.
GPU_FLOAT16_MIN_FREE_MB = 4500
GPU_INT8_MIN_FREE_MB = 2500
PROMPT = "以下是臺灣繁體中文的語音內容。"

# K dictation and the 錄音轉文字 batch take this OS mutex before putting Whisper on the GPU: whoever
# holds it keeps the GPU, a later dictation uses the CPU instead of waiting, a later batch waits.
# Windows releases it when the holder exits or crashes (WAIT_ABANDONED).
MUTEX_NAME = "Local\\WhisperGpuShared-v1"
WAIT_OBJECT_0 = 0x00000000
WAIT_ABANDONED = 0x00000080


def windows_kernel32():
    from ctypes import wintypes
    k32 = ctypes.WinDLL("kernel32", use_last_error=True)
    k32.CreateMutexW.argtypes = [ctypes.c_void_p, wintypes.BOOL, wintypes.LPCWSTR]
    k32.CreateMutexW.restype = wintypes.HANDLE
    k32.WaitForSingleObject.argtypes = [wintypes.HANDLE, wintypes.DWORD]
    k32.WaitForSingleObject.restype = wintypes.DWORD
    k32.ReleaseMutex.argtypes = [wintypes.HANDLE]
    k32.CloseHandle.argtypes = [wintypes.HANDLE]
    return k32


class WindowsGpuMutex:
    """Acquires and releases the shared Windows named GPU mutex."""

    def __init__(self, name=MUTEX_NAME, kernel32=None):
        self.name = name
        self.kernel32 = kernel32
        self.handle = None
        self.acquired = False

    def _k32(self):
        if self.kernel32 is not None:
            return self.kernel32
        if sys.platform == "win32":
            self.kernel32 = windows_kernel32()
            return self.kernel32
        return None

    def acquire(self, timeout_ms=0):
        k32 = self._k32()
        if not k32:
            return False
        if not self.handle:
            self.handle = k32.CreateMutexW(None, False, self.name)
            if not self.handle:
                return False
        res = k32.WaitForSingleObject(self.handle, timeout_ms)
        if res in (WAIT_OBJECT_0, WAIT_ABANDONED):
            self.acquired = True
            return True
        k32.CloseHandle(self.handle)
        self.handle = None
        return False

    def release(self):
        if self.acquired and self.handle:
            k32 = self._k32()
            if k32:
                try:
                    k32.ReleaseMutex(self.handle)
                except Exception:
                    pass
            self.acquired = False
        if self.handle:
            k32 = self._k32()
            if k32:
                try:
                    k32.CloseHandle(self.handle)
                except Exception:
                    pass
            self.handle = None


def load_cuda_dll_directories():
    """Keep DLL search additions process-local and scoped to the existing venv."""
    handles = []
    site_packages = os.path.join(os.path.dirname(os.path.dirname(sys.executable)), "Lib", "site-packages")
    for package in ("cublas", "cuda_runtime", "cuda_nvrtc", "cudnn"):
        directory = os.path.join(site_packages, "nvidia", package, "bin")
        if os.path.isdir(directory) and hasattr(os, "add_dll_directory"):
            handles.append(os.add_dll_directory(directory))
    return handles


def read_pcm16_mono_16k(raw):
    # wave reads from BytesIO, accepts legal ancillary RIFF chunks, and never
    # writes the supplied audio to a file.
    with wave.open(io.BytesIO(raw), "rb") as audio:
        if (audio.getcomptype() != "NONE" or audio.getnchannels() != 1 or
                audio.getsampwidth() != 2 or audio.getframerate() != SAMPLE_RATE):
            raise ValueError("WAV must be uncompressed PCM16 mono at 16 kHz")
        frames = audio.getnframes()
        if frames <= 0 or frames > MAX_SECONDS * SAMPLE_RATE:
            raise ValueError("WAV duration must be greater than zero and no longer than five minutes")
        pcm = audio.readframes(frames)
        if len(pcm) != frames * 2:
            raise ValueError("Truncated WAV audio data")
    import numpy as np
    return np.frombuffer(pcm, dtype="<i2").astype(np.float32) / 32768.0


def query_gpu_sample(run_cmd=None):
    """Queries a single utilization and memory.free sample from nvidia-smi."""
    cmd = [
        "nvidia-smi",
        "--query-gpu=utilization.gpu,memory.free",
        "--format=csv,noheader,nounits"
    ]
    if run_cmd:
        stdout = run_cmd(cmd)
    else:
        result = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            timeout=1,
            check=True,
            creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0)
        )
        stdout = result.stdout
    line = stdout.strip().splitlines()[0]
    parts = [p.strip().replace("%", "").replace("MiB", "").strip() for p in line.split(",")]
    if len(parts) < 2:
        raise ValueError("Invalid nvidia-smi output format")
    util = int(parts[0])
    free_mb = int(parts[1])
    return util, free_mb


def sample_gpu_load(query_fn=query_gpu_sample, sleep_fn=time.sleep):
    """Takes 3 samples over ~1 second, with per-query and total bounded time."""
    samples = []
    start_time = time.monotonic()
    total_budget = 1.5
    for i in range(3):
        if i > 0:
            elapsed = time.monotonic() - start_time
            if elapsed < 1.0:
                delay = min(0.35, max(0.01, (1.0 - elapsed) / (3 - i)))
                sleep_fn(delay)
            if (time.monotonic() - start_time) > total_budget:
                raise TimeoutError("GPU sampling total budget exceeded")
        util, free_mb = query_fn()
        samples.append((util, free_mb))
    return samples


def evaluate_gpu_compute_type(samples):
    """Evaluates 3 samples: 2 of 3 >= 70% utilization -> CPU; else memory threshold."""
    high_util_count = sum(1 for util, _ in samples if util >= 70)
    if high_util_count >= 2:
        return None
    min_free_mb = min(free_mb for _, free_mb in samples)
    if min_free_mb >= GPU_FLOAT16_MIN_FREE_MB:
        return "float16"
    if min_free_mb >= GPU_INT8_MIN_FREE_MB:
        return "int8_float16"
    return None


def gpu_compute_type(query_fn=query_gpu_sample, sleep_fn=time.sleep):
    """Returns GPU compute type that fits, or None if load is high, memory is low, or query fails."""
    try:
        samples = sample_gpu_load(query_fn=query_fn, sleep_fn=sleep_fn)
        return evaluate_gpu_compute_type(samples)
    except Exception as exc:
        sys.stderr.write(f"GPU query failed or format abnormal, using CPU: {type(exc).__name__}: {exc}\n")
        return None


def load_model(device, compute_type):
    from faster_whisper import WhisperModel
    kwargs = {"device": device, "compute_type": compute_type, "local_files_only": True}
    if device == "cpu":
        kwargs["cpu_threads"] = 8
    return WhisperModel(MODEL, **kwargs)


def transcribe(model, audio):
    segments, _ = model.transcribe(audio, beam_size=5, language="zh", vad_filter=True, initial_prompt=PROMPT)
    return "".join(segment.text for segment in segments).strip()


def main(mutex_cls=WindowsGpuMutex, query_fn=query_gpu_sample, sleep_fn=time.sleep):
    # The helper accepts only raw WAV bytes on stdin. No request-provided path,
    # model name or command is interpreted; the trusted parent supplies the
    # offline model path through its process environment.
    # The model is loaded before audio arrives so the parent can start it early (prewarm).
    sys.stdout.reconfigure(encoding="utf-8")
    sys.stderr.reconfigure(encoding="utf-8")
    if not MODEL:
        raise ValueError("K_DICTATION_MODEL is required")
    dll_handles = load_cuda_dll_directories()
    os.environ["HF_HUB_OFFLINE"] = "1"
    os.environ["HF_HUB_DISABLE_TELEMETRY"] = "1"
    os.environ["TRANSFORMERS_OFFLINE"] = "1"

    gpu_mutex = mutex_cls()
    acquired = gpu_mutex.acquire(timeout_ms=0)
    compute_type = None

    if acquired:
        compute_type = gpu_compute_type(query_fn=query_fn, sleep_fn=sleep_fn)
        if not compute_type:
            gpu_mutex.release()
    else:
        sys.stderr.write("GPU mutex busy, using CPU\n")

    model = None
    if compute_type:
        try:
            model = load_model("cuda", compute_type)
        except Exception as exc:
            sys.stderr.write(f"GPU load failed, using CPU: {type(exc).__name__}: {exc}\n")
        if model is None:
            # Outside the except block the traceback no longer holds the partial GPU allocations.
            gc.collect()
            gpu_mutex.release()

    on_gpu = model is not None
    if not on_gpu:
        model = load_model("cpu", "int8")

    raw = sys.stdin.buffer.read()
    if not raw:
        raise ValueError("Empty WAV input")
    audio = read_pcm16_mono_16k(raw)
    try:
        text = transcribe(model, audio)
    except Exception as exc:
        if not on_gpu:
            raise
        sys.stderr.write(f"GPU transcription failed, retrying on CPU: {type(exc).__name__}: {exc}\n")
        text = None

    if text is None:
        model = None  # Free the GPU memory before the slower CPU retry.
        gc.collect()
        gpu_mutex.release()
        text = transcribe(load_model("cpu", "int8"), audio)

    sys.stdout.write(json.dumps({"ok": True, "text": text}, ensure_ascii=False) + "\n")
    # Retain the DLL directory handles through model inference.
    _ = dll_handles


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:  # Preserve the concrete child error for the caller.
        sys.stderr.write(f"{type(exc).__name__}: {exc}\n")
        sys.exit(1)
