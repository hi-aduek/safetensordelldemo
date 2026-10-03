import json
import os
from pathlib import Path
from typing import Any

import httpx
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
from dotenv import load_dotenv


load_dotenv(Path(__file__).resolve().parent.parent / ".env")


app = FastAPI(title="Fieldview Local Agent", version="0.1.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=os.getenv("CORS_ORIGINS", "http://localhost:5173").split(","),
    allow_methods=["GET", "POST"],
    allow_headers=["Content-Type"],
)


class LayerContext(BaseModel):
    name: str = Field(max_length=160)
    kind: str = Field(max_length=40)


class ProposeRequest(BaseModel):
    prompt: str = Field(min_length=3, max_length=2000)
    layers: list[LayerContext] = Field(default_factory=list, max_length=100)


class FeatureCollection(BaseModel):
    type: str
    features: list[dict[str, Any]] = Field(max_length=500)


class Proposal(BaseModel):
    summary: str = Field(min_length=1, max_length=600)
    geojson: FeatureCollection


def validate_geojson(collection: FeatureCollection) -> None:
    if collection.type != "FeatureCollection":
        raise ValueError("Output must be a GeoJSON FeatureCollection")
    allowed = {"Point", "MultiPoint", "LineString", "MultiLineString", "Polygon", "MultiPolygon"}

    def check_positions(value: Any) -> None:
        if not isinstance(value, list):
            raise ValueError("Coordinates must be arrays")
        if len(value) >= 2 and all(isinstance(item, (int, float)) for item in value[:2]):
            if not (-180 <= value[0] <= 180 and -90 <= value[1] <= 90):
                raise ValueError("Coordinates must use longitude/latitude degrees")
            return
        for item in value:
            check_positions(item)

    for feature in collection.features:
        if feature.get("type") != "Feature":
            raise ValueError("Every item must be a GeoJSON Feature")
        geometry = feature.get("geometry")
        if not isinstance(geometry, dict) or geometry.get("type") not in allowed:
            raise ValueError("Feature geometry type is not supported")
        check_positions(geometry.get("coordinates"))
        properties = feature.get("properties")
        if properties is not None and not isinstance(properties, dict):
            raise ValueError("Feature properties must be an object or null")


@app.get("/api/health")
async def health() -> dict[str, str | bool]:
    return {
        "ok": True,
        "model_configured": bool(os.getenv("LOCAL_LLM_MODEL")),
        "endpoint": os.getenv("LOCAL_LLM_BASE_URL", "http://localhost:8001/v1"),
    }


@app.post("/api/agent/propose")
async def propose(request: ProposeRequest) -> dict[str, Any]:
    base_url = os.getenv("LOCAL_LLM_BASE_URL", "http://localhost:8001/v1").rstrip("/")
    model = os.getenv("LOCAL_LLM_MODEL", "")
    api_key = os.getenv("LOCAL_LLM_API_KEY", "local-demo")
    if not model:
        raise HTTPException(
            status_code=503,
            detail="Configure LOCAL_LLM_MODEL and point LOCAL_LLM_BASE_URL at your local OpenAI-compatible model server.",
        )

    system = """You are a geospatial map assistant. Return only a JSON object with exactly these keys: summary and geojson. geojson must be a valid GeoJSON FeatureCollection. Coordinates must be [longitude, latitude] in WGS84 degrees. Make useful, clearly named map features based on the user's request. When the request does not specify a location, choose a plausible location near Denver, Colorado (39.7392, -104.9903). Use concise feature properties with a name and description. Never claim you inspected source data that was not included in the context. Limit output to 30 features."""
    context = {
        "user_request": request.prompt,
        "existing_layers": [layer.model_dump() for layer in request.layers],
    }
    payload = {
        "model": model,
        "temperature": 0.2,
        "response_format": {"type": "json_object"},
        "messages": [
            {"role": "system", "content": system},
            {"role": "user", "content": json.dumps(context)},
        ],
    }
    try:
        async with httpx.AsyncClient(timeout=120) as client:
            response = await client.post(
                f"{base_url}/chat/completions",
                json=payload,
                headers={"Authorization": f"Bearer {api_key}"},
            )
            response.raise_for_status()
            message = response.json()["choices"][0]["message"]["content"]
            data = json.loads(message)
            proposal = Proposal.model_validate(data)
            validate_geojson(proposal.geojson)
            return {**proposal.model_dump(), "model": model}
    except httpx.HTTPStatusError as exc:
        raise HTTPException(status_code=502, detail=f"Local model server returned HTTP {exc.response.status_code}.") from exc
    except httpx.RequestError as exc:
        raise HTTPException(status_code=502, detail="Could not connect to the configured local model server.") from exc
    except (KeyError, IndexError, json.JSONDecodeError, ValueError) as exc:
        raise HTTPException(status_code=502, detail="The local model returned invalid GeoJSON. Try a more specific request.") from exc
