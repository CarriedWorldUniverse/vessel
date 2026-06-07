#!/usr/bin/env python3
"""Vessel-controlled VoxCPM sidecar.

This process intentionally owns the Python/PyTorch/VoxCPM dependency surface.
The Electron/Tauri shell talks to it over a local-only OpenAI-compatible TTS API.
"""

from __future__ import annotations

import argparse
import io
import os

import torch
import re
import numpy as np
from contextlib import asynccontextmanager
from functools import lru_cache

import soundfile as sf
from fastapi import FastAPI, HTTPException
from fastapi.responses import Response
from pydantic import BaseModel


ready = False


class SpeechRequest(BaseModel):
    model: str = "openbmb/VoxCPM2"
    input: str
    voice: str = "default"
    response_format: str = "wav"


@lru_cache(maxsize=1)
def load_model(model_id: str):
    try:
        from voxcpm import VoxCPM
    except ImportError as exc:
        raise RuntimeError(
            "VoxCPM is not installed. Install the Carried World fork with "
            "`git clone https://github.com/nexus-cw/VoxCPM && cd VoxCPM && pip install -e .`, "
            "then install `fastapi uvicorn soundfile`."
        ) from exc

    return VoxCPM.from_pretrained(
        model_id,
        load_denoiser=os.getenv("VESSEL_VOXCPM_LOAD_DENOISER", "0") == "1",
    )


def _chunk_text(text: str, max_chars: int):
    """Split text into <= max_chars sentence-level chunks.

    VoxCPM2's LM cache is 4096 tokens, shared between the input text and the
    generated audio tokens (audio is capped ~2000 and dominates). A long
    utterance overflows that cache and triggers a CUDA device-side assert
    (index out of bounds) that poisons the whole process. Synthesizing in
    sentence-level chunks keeps every call well within the cache.
    """
    text = text.strip()
    if not text:
        return []
    if len(text) <= max_chars:
        return [text]
    parts = re.split(r"(?<=[.!?])\s+|\n+", text)
    chunks = []
    cur = ""
    for part in parts:
        part = part.strip()
        if not part:
            continue
        while len(part) > max_chars:  # a single over-long sentence: hard-split
            cut = part.rfind(" ", 0, max_chars)
            cut = cut if cut > 0 else max_chars
            chunks.append(part[:cut].strip())
            part = part[cut:].strip()
        if not cur:
            cur = part
        elif len(cur) + 1 + len(part) <= max_chars:
            cur += " " + part
        else:
            chunks.append(cur)
            cur = part
    if cur:
        chunks.append(cur)
    return [c for c in chunks if c]


def synthesize(text: str, model_id: str):
    model = load_model(model_id)
    sample_rate = getattr(model.tts_model, "sample_rate", 48000)
    # Guard against VoxCPM2's 4096-token LM cache: synthesize in sentence-level
    # chunks so a long utterance cannot overflow it and poison the CUDA context.
    max_chars = int(os.getenv("VESSEL_VOXCPM_MAX_CHARS", "300"))
    cfg_value = float(os.getenv("VESSEL_VOXCPM_CFG_VALUE", "2.0"))
    timesteps = int(os.getenv("VESSEL_VOXCPM_INFERENCE_TIMESTEPS", "10"))
    wavs = []
    for chunk in _chunk_text(text, max_chars):
        with torch.inference_mode():
            wavs.append(model.generate(text=chunk, cfg_value=cfg_value, inference_timesteps=timesteps))
        # Release the per-request CUDA cache so VRAM does not creep (the cached
        # allocator otherwise holds freed blocks).
        if torch.cuda.is_available():
            torch.cuda.empty_cache()
    if not wavs:
        return np.zeros(0, dtype="float32"), sample_rate
    if len(wavs) == 1:
        return wavs[0], sample_rate
    gap = np.zeros(int(sample_rate * 0.15), dtype=wavs[0].dtype)  # brief pause between chunks
    joined = []
    for i, w in enumerate(wavs):
        if i:
            joined.append(gap)
        joined.append(w)
    return np.concatenate(joined), sample_rate


def warmup() -> None:
    global ready
    model_id = os.getenv("VESSEL_VOXCPM_MODEL", "openbmb/VoxCPM2")
    if os.getenv("VESSEL_VOXCPM_PRELOAD", "0") == "1":
        warmup_text = os.getenv(
            "VESSEL_VOXCPM_WARMUP_TEXT",
            "(neutral clear voice) Vessel voice service is ready.",
        )
        synthesize(warmup_text, model_id)
    else:
        load_model(model_id)
    ready = True


@asynccontextmanager
async def lifespan(_app: FastAPI):
    warmup()
    yield


app = FastAPI(title="Vessel VoxCPM Sidecar", lifespan=lifespan)


@app.get("/health")
def health() -> dict[str, object]:
    return {"status": "ok" if ready else "warming", "ready": ready}


@app.get("/v1/models")
def models() -> dict[str, object]:
    model = os.getenv("VESSEL_VOXCPM_MODEL", "openbmb/VoxCPM2")
    return {"object": "list", "data": [{"id": model, "object": "model", "owned_by": "openbmb"}]}


@app.post("/v1/audio/speech")
def speech(req: SpeechRequest) -> Response:
    text = req.input.strip()
    if not text:
        raise HTTPException(status_code=400, detail="input is required")
    if req.response_format != "wav":
        raise HTTPException(status_code=400, detail="only wav response_format is supported")

    model_id = os.getenv("VESSEL_VOXCPM_MODEL", req.model)
    try:
        wav, sample_rate = synthesize(text, model_id)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc

    buf = io.BytesIO()
    sf.write(buf, wav, sample_rate, format="WAV")
    return Response(content=buf.getvalue(), media_type="audio/wav")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=int(os.getenv("VESSEL_VOXCPM_LISTEN_PORT", "8765")))
    args = parser.parse_args()

    import uvicorn

    uvicorn.run(app, host=args.host, port=args.port)


if __name__ == "__main__":
    main()
