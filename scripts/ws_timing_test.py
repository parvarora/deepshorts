"""Diagnostic: connect to the deployed /api/generate/ws and timestamp every frame.

Tells us, authoritatively, whether agent-step frames arrive incrementally (transport
is fine — any "no live progress" bug is client-side) or all in one burst at the end
(something between Cloud Run and us is buffering the WebSocket).

Usage (PowerShell):
    $env:WS_BASE = "https://deepshorts-api-xxxxx-as.a.run.app"   # your Cloud Run URL
    python scripts/ws_timing_test.py
"""
import asyncio
import json
import os
import time

import websockets

HTTP_BASE = os.environ.get("WS_BASE", "http://localhost:8000").rstrip("/")
WS_URL = HTTP_BASE.replace("https://", "wss://").replace("http://", "ws://") + "/api/generate/ws"

REQUEST = {"situation": "Roommate ate the last slice of pizza", "mood": None, "director": None}


async def main():
    print(f"connecting -> {WS_URL}")
    t0 = time.monotonic()
    async with websockets.connect(WS_URL, open_timeout=20, max_size=None) as ws:
        await ws.send(json.dumps(REQUEST))
        print(f"[{time.monotonic() - t0:6.2f}s] request sent")
        async for raw in ws:
            dt = time.monotonic() - t0
            evt = json.loads(raw)
            kind = evt.get("type")
            if kind == "step":
                node = evt.get("node")
                step = (evt.get("trace") or {}).get("step")
                print(f"[{dt:6.2f}s] step   node={node:<14} trace.step={step}")
            elif kind == "result":
                title = (evt.get("script") or {}).get("movie_title")
                print(f"[{dt:6.2f}s] RESULT title={title!r}")
            elif kind == "error":
                print(f"[{dt:6.2f}s] ERROR  kind={evt.get('kind')} {evt.get('error')}")
    print(f"[{time.monotonic() - t0:6.2f}s] socket closed")


if __name__ == "__main__":
    asyncio.run(main())
