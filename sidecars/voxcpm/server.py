#!/usr/bin/env python3
"""Vessel-controlled VoxCPM sidecar.

This process intentionally owns the Python/PyTorch/VoxCPM dependency surface.
The Electron/Tauri shell talks to it over a local-only OpenAI-compatible TTS API.
"""

from __future__ import annotations

import argparse
import io
import os
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


def synthesize(text: str, model_id: str):
    model = load_model(model_id)
    wav = model.generate(
        text=text,
        cfg_value=float(os.getenv("VESSEL_VOXCPM_CFG_VALUE", "2.0")),
        inference_timesteps=int(os.getenv("VESSEL_VOXCPM_INFERENCE_TIMESTEPS", "10")),
    )
    sample_rate = getattr(model.tts_model, "sample_rate", 48000)
    return wav, sample_rate


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
