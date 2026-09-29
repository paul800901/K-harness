"""One-shot, stdin-only offline transcription helper for K."""

import io
import json
import os
import sys
import wave

PYTHON = r"D:\錄音轉文字\runtime\asr_faster_whisper_venv\Scripts\python.exe"
MODEL = r"D:\錄音轉文字\runtime\models\hf_cache\models--Systran--faster-whisper-large-v3\snapshots\edaa852ec7e145841d8ffdb056a99866b5f0a478"
MAX_SECONDS = 5 * 60
SAMPLE_RATE = 16_000


def load_cuda_dll_directories():
    """Keep DLL search additions process-local and scoped to the existing venv."""
    handles = []
    site_packages = os.path.join(os.path.dirname(os.path.dirname(PYTHON)), "Lib", "site-packages")
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


def main():
    # The helper accepts only raw WAV bytes on stdin. No request-provided path,
    # model name, command, or environment setting is interpreted.
    sys.stdout.reconfigure(encoding="utf-8")
    sys.stderr.reconfigure(encoding="utf-8")
    raw = sys.stdin.buffer.read()
    if not raw:
        raise ValueError("Empty WAV input")
    audio = read_pcm16_mono_16k(raw)
    dll_handles = load_cuda_dll_directories()
    os.environ["HF_HUB_OFFLINE"] = "1"
    os.environ["HF_HUB_DISABLE_TELEMETRY"] = "1"
    os.environ["TRANSFORMERS_OFFLINE"] = "1"
    from faster_whisper import WhisperModel

    model = WhisperModel(MODEL, device="cuda", compute_type="float16", local_files_only=True)
    segments, _ = model.transcribe(audio, beam_size=5, language="zh", vad_filter=True,
                                  initial_prompt="以下是臺灣繁體中文的語音內容。")
    text = "".join(segment.text for segment in segments).strip()
    sys.stdout.write(json.dumps({"ok": True, "text": text}, ensure_ascii=False) + "\n")
    # Retain the DLL directory handles through model inference.
    _ = dll_handles


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:  # Preserve the concrete child error for the caller.
        sys.stderr.write(f"{type(exc).__name__}: {exc}\n")
        sys.exit(1)
