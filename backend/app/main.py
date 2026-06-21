"""FastAPI surface for the AI Bollywood Script Generator.

Endpoints
  GET  /api/health            - liveness + config sanity
  GET  /api/options           - moods + directors for the dropdowns
  GET  /api/pipeline          - static agent graph for the UI visualization
  POST /api/generate          - situation (+mood/director) -> full Script
  POST /api/generate/stream   - same, but Server-Sent Events for live agent visualization
  POST /api/regenerate        - regenerate one section (title/scene/dialogue/characters)

Every response carries enough in `meta` (situation/mood/director/title/trace) for the
client to maintain its localStorage history and to power per-section regeneration.
"""
from __future__ import annotations

import json
import uuid

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles

from app.config import settings
from app.graph.pipeline import PIPELINE_GRAPH, _final_meta, run, stream
from app.llm.client import AgentError
from app.llm.rate_limiter import RateLimitExceeded
from app.prompts_loader import list_directors, list_moods, pretty
from app.schemas import GenerateRequest, GenerateResponse, RegenerateRequest

app = FastAPI(title="AI Bollywood Script Generator", version="1.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Serve director photos (top-level directors/<id>.jpg) for the UI selector.
if settings.director_images_dir.exists():
    app.mount(
        "/assets/directors",
        StaticFiles(directory=str(settings.director_images_dir)),
        name="director_images",
    )

_IMG_EXTS = ("jpg", "jpeg", "png", "webp", "avif")


def _director_image(did: str) -> str | None:
    for ext in _IMG_EXTS:
        if (settings.director_images_dir / f"{did}.{ext}").exists():
            return f"/assets/directors/{did}.{ext}"
    return None

_TARGET_TO_MODE = {
    "title": "regen_meta", "tagline": "regen_meta", "meta": "regen_meta",
    "scene": "regen_scene", "dialogue": "regen_dialogue", "characters": "regen_characters",
}


def _err(status: int, kind: str, message: str) -> JSONResponse:
    return JSONResponse(status_code=status, content={"ok": False, "error": message, "kind": kind})


# --------------------------------------------------------------- meta endpoints
@app.get("/api/health")
def health():
    return {
        "status": "ok",
        "model": settings.gemini_model,
        "has_api_key": bool(settings.gemini_api_key),
        "moods": len(list_moods()),
        "directors": len(list_directors()),
    }


@app.get("/api/options")
def options():
    return {
        "moods": [{"id": m, "label": pretty(m)} for m in list_moods()],
        "directors": [
            {"id": d, "label": pretty(d), "image": _director_image(d)}
            for d in list_directors()
        ],
    }


@app.get("/api/pipeline")
def pipeline():
    return PIPELINE_GRAPH


# --------------------------------------------------------------- generation
def _generate_state(req: GenerateRequest) -> dict:
    return {
        "request_id": uuid.uuid4().hex,
        "mode": "full",
        "situation": req.situation,
        "mood": req.mood,
        "director": req.director,
        "characters_hint": req.characters_hint,
        "trace": [],
    }


@app.post("/api/generate", response_model=GenerateResponse)
def generate(req: GenerateRequest):
    try:
        script, meta = run(_generate_state(req))
        return GenerateResponse(script=script, meta={**meta, "title": script.movie_title})
    except RateLimitExceeded as exc:
        return _err(429, "rate_limit", str(exc))
    except AgentError as exc:
        return _err(502, "agent", str(exc))
    except Exception as exc:  # noqa: BLE001 - last-resort graceful failure
        return _err(500, "server", f"{type(exc).__name__}: {exc}")


def _sse(obj: dict) -> str:
    return f"data: {json.dumps(obj, default=str)}\n\n"


@app.post("/api/generate/stream")
def generate_stream(req: GenerateRequest):
    """Stream per-agent events as the graph runs, then the final result (SSE)."""
    initial = _generate_state(req)
    merged = dict(initial)

    def gen():
        try:
            for node, partial in stream(initial):
                merged.update(partial)
                last = (partial.get("trace") or [{}])[-1]
                yield _sse({"type": "step", "node": node, "trace": last})
            script = merged.get("script")
            meta = _final_meta(merged)
            if script:
                meta["title"] = script.get("movie_title")
            yield _sse({"type": "result", "script": script, "meta": meta})
        except RateLimitExceeded as exc:
            yield _sse({"type": "error", "kind": "rate_limit", "error": str(exc)})
        except Exception as exc:  # noqa: BLE001
            yield _sse({"type": "error", "kind": "agent", "error": f"{type(exc).__name__}: {exc}"})

    return StreamingResponse(gen(), media_type="text/event-stream")


# --------------------------------------------------------------- regeneration
@app.post("/api/regenerate", response_model=GenerateResponse)
def regenerate(req: RegenerateRequest):
    mode = _TARGET_TO_MODE.get(req.target.type)
    if mode is None:
        return _err(400, "bad_request", f"unknown target type: {req.target.type}")
    if req.target.type in ("scene", "dialogue") and req.target.index is None:
        return _err(400, "bad_request", f"target '{req.target.type}' requires an index")

    state = {
        "request_id": uuid.uuid4().hex,
        "mode": mode,
        "canon_script": req.script.model_dump(),
        "target_index": req.target.index,
        "mood": req.mood,
        "director": req.director,
        "note": req.note,
        "trace": [],
    }
    try:
        script, meta = run(state)
        return GenerateResponse(script=script, meta={**meta, "title": script.movie_title})
    except RateLimitExceeded as exc:
        return _err(429, "rate_limit", str(exc))
    except AgentError as exc:
        return _err(502, "agent", str(exc))
    except Exception as exc:  # noqa: BLE001
        return _err(500, "server", f"{type(exc).__name__}: {exc}")


@app.get("/")
def root():
    return {"service": "AI Bollywood Script Generator", "docs": "/docs", "health": "/api/health"}
