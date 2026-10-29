from __future__ import annotations

import asyncio
import os
import time
from typing import Annotated, Literal
from uuid import uuid4

from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from .analysis import AnalysisResult, UploadedMedia, analyze_inputs
from .providers import OpenAICompatibleProvider

MAX_UPLOAD_BYTES = 20 * 1024 * 1024
MAX_IMAGE_BYTES = 10 * 1024 * 1024
MediaName = Literal["image", "audio", "video"]


class ReflectionResponse(AnalysisResult):
    request_id: str
    timing_ms: int
    save_status: str = "not_saved"


app = FastAPI(title="AURA API", version="0.1.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://127.0.0.1:3000"],
    allow_credentials=False,
    allow_methods=["GET", "POST", "DELETE"],
    allow_headers=["Content-Type"],
)


SIGNATURES: dict[MediaName, dict[str, tuple[bytes, int]]] = {
    "image": {
        "image/jpeg": (b"\xff\xd8\xff", 0),
        "image/png": (b"\x89PNG\r\n\x1a\n", 0),
        "image/webp": (b"WEBP", 8),
        "image/gif": (b"GIF8", 0),
    },
    "audio": {
        "audio/mpeg": (b"ID3", 0),
        "audio/wav": (b"RIFF", 0),
        "audio/mp4": (b"ftyp", 4),
        "audio/ogg": (b"OggS", 0),
        "audio/webm": (b"\x1aE\xdf\xa3", 0),
        "audio/x-m4a": (b"ftyp", 4),
    },
    "video": {
        "video/mp4": (b"ftyp", 4),
        "video/webm": (b"\x1aE\xdf\xa3", 0),
        "video/quicktime": (b"ftypqt", 4),
    },
}


@app.get("/")
async def api_index() -> dict[str, str]:
    return {
        "name": "AURA API",
        "docs": "/docs",
        "health": "/health",
        "readiness": "/ready",
        "analyze": "/analyze",
    }


async def validate_upload(kind: MediaName, upload: UploadFile) -> bytes:
    expected = SIGNATURES[kind].get(upload.content_type or "")
    if expected is None:
        raise HTTPException(status_code=415, detail=f"Unsupported {kind} format.")
    content = await upload.read(MAX_UPLOAD_BYTES + 1)
    if not content:
        raise HTTPException(status_code=400, detail=f"The {kind} file is empty.")
    byte_limit = MAX_IMAGE_BYTES if kind == "image" else MAX_UPLOAD_BYTES
    if len(content) > byte_limit:
        limit_mb = byte_limit // (1024 * 1024)
        raise HTTPException(status_code=413, detail=f"The {kind} file exceeds the {limit_mb} MB limit.")
    signature, offset = expected
    if content[offset : offset + len(signature)] != signature:
        raise HTTPException(status_code=400, detail=f"The {kind} file content does not match its format.")
    await upload.close()
    return content


@app.get("/health")
async def health() -> dict[str, str]:
    provider = OpenAICompatibleProvider()
    return {"status": "ok", "mode": "provider" if provider.ready else "mock"}


@app.get("/ready")
async def ready() -> dict[str, str | bool]:
    provider = OpenAICompatibleProvider()
    return {
        "ready": True,
        "mode": "provider" if provider.ready else "mock",
        "providers_configured": provider.ready,
        "vision": provider.can_process_image(),
        "transcription": provider.can_transcribe(),
        "text_generation": provider.can_process_text(),
        "provider_disclosure": "Configured requests send the selected journal text and media to the server's configured OpenAI-compatible provider.",
    }


@app.get("/usage")
async def usage() -> dict[str, object]:
    provider = OpenAICompatibleProvider()
    capabilities = provider.capabilities
    models = [model for model in (capabilities.vision_model, capabilities.transcription_model, capabilities.text_model) if model]
    return {
        "mode": "provider" if provider.ready else "mock",
        "providers": ["openai-compatible"] if provider.ready else [],
        "models": models if provider.ready else [],
        "note": "Usage totals are not available from this adapter.",
    }


@app.get("/examples")
async def examples() -> dict[str, list[str]]:
    return {"reflection_prompts": ["One moment I want to remember is...", "Something that felt challenging today was..."]}


@app.post("/analyze", response_model=ReflectionResponse)
async def analyze(
    text: Annotated[str | None, Form(max_length=5000)] = None,
    image: Annotated[UploadFile | None, File()] = None,
    audio: Annotated[UploadFile | None, File()] = None,
    video: Annotated[UploadFile | None, File()] = None,
    consent_to_provider: Annotated[bool, Form()] = False,
    show_islamic_support: Annotated[bool, Form()] = False,
) -> ReflectionResponse:
    started = time.perf_counter()
    uploads: dict[MediaName, UploadFile | None] = {"image": image, "audio": audio, "video": video}
    media: dict[str, UploadedMedia | None] = {"image": None, "audio": None, "video": None}
    for kind, upload in uploads.items():
        if upload is not None:
            content = await validate_upload(kind, upload)
            media[kind] = UploadedMedia(upload.filename or f"upload.{kind}", content, upload.content_type or "")

    note = (text or "").strip()
    if not note and not any(media.values()):
        raise HTTPException(status_code=422, detail="Provide text or at least one supported media file.")
    try:
        timeout_seconds = max(5, min(180, int(os.getenv("AURA_ANALYSIS_TIMEOUT_SECONDS", "120"))))
        async with asyncio.timeout(timeout_seconds):
            result = await analyze_inputs(note, media, consent_to_provider, OpenAICompatibleProvider(), show_islamic_support)
    except PermissionError as error:
        raise HTTPException(status_code=428, detail=str(error)) from error
    except TimeoutError as error:
        raise HTTPException(status_code=504, detail="AURA analysis exceeded its configured time limit.") from error
    return ReflectionResponse(
        **result.model_dump(),
        request_id=str(uuid4()),
        timing_ms=round((time.perf_counter() - started) * 1000),
    )


@app.get("/reflections")
async def list_reflections() -> dict[str, object]:
    return {"items": [], "storage": "disabled"}


@app.get("/reflections/{reflection_id}")
async def get_reflection(reflection_id: str) -> None:
    raise HTTPException(status_code=404, detail="Reflection storage is not enabled.")


@app.delete("/reflections/{reflection_id}")
async def delete_reflection(reflection_id: str) -> None:
    raise HTTPException(status_code=404, detail="Reflection storage is not enabled.")