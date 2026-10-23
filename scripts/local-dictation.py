"""One-shot, stdin-only offline transcription helper for K."""

import io
import json
import os
import subprocess
import sys
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


def gpu_compute_type():
    """Returns the GPU compute type that fits, or None to use the CPU."""
    try:
        result = subprocess.run(["nvidia-smi", "--query-gpu=memory.free", "--format=csv,noheader,nounits"],
                                capture_output=True, text=True, timeout=5, check=True,
                                creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
        free_mb = int(result.stdout.split()[0])
    except Exception:
        return "float16"  # Unknown: keep the previous behaviour; a GPU failure still falls back to the CPU.
    if free_mb >= GPU_FLOAT16_MIN_FREE_MB:
        return "float16"
    if free_mb >= GPU_INT8_MIN_FREE_MB:
        return "int8_float16"
    return None


def load_model(device, compute_type):
    from faster_whisper import WhisperModel
    return WhisperModel(MODEL, device=device, compute_type=compute_type, local_files_only=True)


def transcribe(model, audio):
    segments, _ = model.transcribe(audio, beam_size=5, language="zh", vad_filter=True, initial_prompt=PROMPT)
    return "".join(segment.text for segment in segments).strip()


def main():
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
    model = None
    compute_type = gpu_compute_type()
    if compute_type:
        try:
            model = load_model("cuda", compute_type)
        except Exception as exc:
            sys.stderr.write(f"GPU load failed, using CPU: {type(exc).__name__}: {exc}\n")
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
