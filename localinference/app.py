"""Small voice-to-text and inference router for the Fieldview demo.

All model services are operator supplied. This process never downloads weights.
"""

import os
from pathlib import Path
from typing import Any

import httpx
from dotenv import load_dotenv
from fastapi import FastAPI, File, HTTPException, UploadFile
from pydantic import BaseModel, Field


load_dotenv(Path(__file__).resolve().parent / ".env")

app = FastAPI(title="Local Inference Voice Router", version="0.1.0")


class ChatRequest(BaseModel):
    text: str = Field(min_length=1, max_length=12000)


def setting(name: str, default: str = "") -> str:
    return os.getenv(name, default).strip()


def target_for(text: str) -> str:
    """Keep routing deliberate: map-prefixed requests go to the map API."""
    normalized = text.lstrip().lower()
    return "map" if normalized.startswith(("map:", "geo:", "geospatial:")) else "chat"


def without_route_prefix(text: str) -> str:
    for prefix in ("map:", "geo:", "geospatial:"):
        if text.lstrip().lower().startswith(prefix):
            leading = len(text) - len(text.lstrip())
            return text[:leading] + text.lstrip()[len(prefix):].lstrip()
    return text


async def chat(text: str) -> dict[str, Any]:
    route = target_for(text)
    clean_text = without_route_prefix(text)

    if route == "map" and setting("MAP_API_URL"):
        url = setting("MAP_API_URL").rstrip("/")
        if not url.endswith("/api/agent/propose"):
            url += "/api/agent/propose"
        try:
            async with httpx.AsyncClient(timeout=150) as client:
                response = await client.post(url, json={"prompt": clean_text, "layers": []})
                response.raise_for_status()
                result = response.json()
        except httpx.HTTPError as exc:
            raise HTTPException(status_code=502, detail="The map agent could not be reached.") from exc
        return {"route": route, "text": result.get("summary", ""), "result": result}

    base_url = setting("CHAT_BASE_URL", "https://api.deepseek.com/v1").rstrip("/")
    model = setting("CHAT_MODEL", "deepseek-v4-flash")
    api_key = setting("CHAT_API_KEY")
    if not api_key:
        raise HTTPException(status_code=503, detail="Set CHAT_API_KEY in localinference/.env.")
    try:
        async with httpx.AsyncClient(timeout=150) as client:
            response = await client.post(
                f"{base_url}/chat/completions",
                headers={"Authorization": f"Bearer {api_key}"},
                json={"model": model, "messages": [{"role": "user", "content": clean_text}]},
            )
            response.raise_for_status()
            answer = response.json()["choices"][0]["message"]["content"]
    except httpx.HTTPStatusError as exc:
        raise HTTPException(status_code=502, detail=f"Chat provider returned HTTP {exc.response.status_code}.") from exc
    except (httpx.HTTPError, KeyError, IndexError, TypeError) as exc:
        raise HTTPException(status_code=502, detail="Could not get a valid response from the chat provider.") from exc
    return {"route": route, "model": model, "text": answer}


@app.get("/api/health")
async def health() -> dict[str, Any]:
    return {
        "ok": True,
        "chat_configured": bool(setting("CHAT_API_KEY")),
        "chat_model": setting("CHAT_MODEL", "deepseek-v4-flash"),
        "whisper_configured": bool(setting("WHISPER_BASE_URL")),
        "map_configured": bool(setting("MAP_API_URL")),
        "weights_downloaded_by_this_service": False,
    }


@app.post("/api/chat")
async def chat_text(request: ChatRequest) -> dict[str, Any]:
    return await chat(request.text)


@app.post("/api/voice")
async def voice(file: UploadFile = File(...)) -> dict[str, Any]:
    """Transcribe an uploaded audio clip with a separately hosted Whisper API, then route it."""
    whisper_url = setting("WHISPER_BASE_URL").rstrip("/")
    if not whisper_url:
        raise HTTPException(status_code=503, detail="Set WHISPER_BASE_URL to an existing Whisper-compatible service.")
    if not file.filename:
        raise HTTPException(status_code=400, detail="Audio filename is required.")
    audio = await file.read(25 * 1024 * 1024 + 1)
    if not audio or len(audio) > 25 * 1024 * 1024:
        raise HTTPException(status_code=413, detail="Audio must be non-empty and no larger than 25 MiB.")
    headers = {}
    whisper_key = setting("WHISPER_API_KEY")
    if whisper_key:
        headers["Authorization"] = f"Bearer {whisper_key}"
    try:
        async with httpx.AsyncClient(timeout=180) as client:
            response = await client.post(
                f"{whisper_url}/audio/transcriptions",
                headers=headers,
                data={"model": setting("WHISPER_MODEL", "whisper-1")},
                files={"file": (file.filename, audio, file.content_type or "application/octet-stream")},
            )
            response.raise_for_status()
            transcript = response.json()["text"].strip()
    except httpx.HTTPStatusError as exc:
        raise HTTPException(status_code=502, detail=f"Whisper service returned HTTP {exc.response.status_code}.") from exc
    except (httpx.HTTPError, KeyError, TypeError) as exc:
        raise HTTPException(status_code=502, detail="Could not transcribe audio with the configured Whisper service.") from exc
    if not transcript:
        raise HTTPException(status_code=422, detail="Whisper returned an empty transcript.")
    answer = await chat(transcript)
    return {"transcript": transcript, **answer}
