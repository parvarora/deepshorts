"""Observability: log every prompt and raw response, keyed by request_id + agent.

Multi-agent bugs are miserable to debug because you can't see which agent went wrong.
Every LLM call writes a structured JSONL record (full prompt + full raw response +
thoughts + latency + errors) to logs/<date>.jsonl, plus a short console line.
"""
from __future__ import annotations

import json
import threading
import time

from app.config import settings

_lock = threading.Lock()


def _logfile():
    settings.log_dir.mkdir(parents=True, exist_ok=True)
    return settings.log_dir / (time.strftime("%Y-%m-%d") + ".jsonl")


def _short(v, n: int = 240):
    if isinstance(v, str) and len(v) > n:
        return v[:n] + f"… (+{len(v) - n} chars)"
    return v


def log_event(request_id: str, agent: str, event: str, **data) -> None:
    """Append a full structured record to the daily log and print a short console line."""
    rec = {
        "ts": time.strftime("%Y-%m-%dT%H:%M:%S"),
        "request_id": request_id,
        "agent": agent,
        "event": event,
        **data,
    }
    line = json.dumps(rec, ensure_ascii=False, default=str)
    try:
        with _lock:
            with open(_logfile(), "a", encoding="utf-8") as f:
                f.write(line + "\n")
    except Exception as exc:  # logging must never crash the request
        print(f"[logger error] {exc}")

    preview = {k: _short(v) for k, v in data.items()}
    print(f"[{rec['ts']}] {request_id[:8]} {agent}/{event} {preview}")
