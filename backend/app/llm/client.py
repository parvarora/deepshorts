"""Gemini client wrapper — the single choke point for every model call.

Responsibilities (all the resilience lives here so agents stay simple):
  * rate limiting (token bucket) before each call
  * retry-with-backoff on 429 / 5xx
  * Gemini "thinking" enabled, with thought summaries captured for observability
  * tolerant parsing: strip <think>...</think> tags + code fences, extract the JSON object
  * Pydantic validation, with ONE structured "repair" re-ask on malformed output
  * full prompt + raw response logging on every call
"""
from __future__ import annotations

import json
import random
import re
import time
from typing import Type, TypeVar

from google import genai
from google.genai import types
from pydantic import BaseModel, ValidationError

from app.config import settings
from app.llm.rate_limiter import RateLimiter
from app.observability.logger import log_event

T = TypeVar("T", bound=BaseModel)

_THINK_TAG = re.compile(r"<think>.*?</think>", re.DOTALL | re.IGNORECASE)
_FENCE = re.compile(r"^```(?:json)?|```$", re.MULTILINE)


class AgentError(Exception):
    """Raised when an agent can't produce valid structured output even after a repair."""


def _is_retryable(exc: Exception) -> bool:
    s = str(exc).lower()
    if any(tok in s for tok in ("429", "resource_exhausted", "rate", "503", "500",
                                "unavailable", "overloaded", "deadline", "timeout")):
        return True
    code = getattr(exc, "code", None) or getattr(exc, "status_code", None)
    return code in (429, 500, 503)


def _extract_json(text: str) -> dict:
    """Pull the first balanced JSON object out of a possibly-noisy model response."""
    text = _THINK_TAG.sub("", text)
    text = _FENCE.sub("", text).strip()
    start = text.find("{")
    if start == -1:
        raise ValueError("no JSON object found in model output")
    depth, in_str, esc = 0, False, False
    for i in range(start, len(text)):
        c = text[i]
        if in_str:
            if esc:
                esc = False
            elif c == "\\":
                esc = True
            elif c == '"':
                in_str = False
        else:
            if c == '"':
                in_str = True
            elif c == "{":
                depth += 1
            elif c == "}":
                depth -= 1
                if depth == 0:
                    return json.loads(text[start: i + 1])
    raise ValueError("unbalanced JSON object in model output")


class GeminiClient:
    def __init__(self):
        self.client = genai.Client(api_key=settings.gemini_api_key or None)
        self.model = settings.gemini_model
        self.rl = RateLimiter(settings.rpm_limit, settings.rpd_limit)

    # ---- low level ----
    def _config(self, system: str, thinking: bool) -> types.GenerateContentConfig:
        kwargs: dict = dict(system_instruction=system, temperature=settings.temperature)
        if thinking and hasattr(types, "ThinkingConfig"):
            try:
                kwargs["thinking_config"] = types.ThinkingConfig(include_thoughts=True)
            except Exception:
                pass
        return types.GenerateContentConfig(**kwargs)

    def _raw_call(self, system: str, contents: str):
        thinking = settings.enable_thinking
        last: Exception | None = None
        for attempt in range(settings.max_retries):
            self.rl.acquire()                       # throttle BEFORE spending a request
            try:
                cfg = self._config(system, thinking)
                return self.client.models.generate_content(
                    model=self.model, contents=contents, config=cfg
                )
            except Exception as exc:                # noqa: BLE001 - we classify below
                last = exc
                msg = str(exc).lower()
                if "thinking" in msg or "thinking_config" in msg:
                    thinking = False                # model/version rejected thinking -> drop it
                    continue
                if not _is_retryable(exc) or attempt == settings.max_retries - 1:
                    raise
                backoff = min((2 ** attempt) + random.random(), 30.0)
                time.sleep(backoff)
        raise last if last else RuntimeError("LLM call failed")

    @staticmethod
    def _split_parts(resp) -> tuple[str, str]:
        """Return (answer_text, thought_text) from a thinking-enabled response."""
        answer, thoughts = [], []
        try:
            for part in resp.candidates[0].content.parts:
                txt = getattr(part, "text", None)
                if not txt:
                    continue
                (thoughts if getattr(part, "thought", False) else answer).append(txt)
        except Exception:
            pass
        if not answer:
            answer.append(getattr(resp, "text", "") or "")
        return "".join(answer), "".join(thoughts)

    # ---- high level: validated structured generation ----
    def generate_json(self, request_id: str, agent: str, system: str, user: str,
                      schema: Type[T]) -> T:
        """Call Gemini, parse + validate against `schema`, repairing once if needed."""
        schema_str = json.dumps(schema.model_json_schema())
        contents = (
            f"{user}\n\nReturn ONLY a single JSON object that conforms to this JSON Schema. "
            f"No markdown, no commentary outside the JSON.\nSCHEMA:\n{schema_str}"
        )

        started = time.monotonic()
        resp = self._raw_call(system, contents)
        answer, thoughts = self._split_parts(resp)
        log_event(request_id, agent, "call", system=system, user=contents,
                  raw=answer, thoughts=thoughts, latency_s=round(time.monotonic() - started, 2))

        try:
            return schema.model_validate(_extract_json(answer))
        except (ValueError, ValidationError) as err:
            # ONE structured repair attempt, then fail gracefully.
            log_event(request_id, agent, "repair", error=str(err))
            repair = (
                f"Your previous response was not valid for the schema.\nERROR: {err}\n"
                f"Return ONLY corrected JSON for this schema (no prose):\n{schema_str}\n"
                f"PREVIOUS OUTPUT:\n{answer[:4000]}"
            )
            resp2 = self._raw_call(system, repair)
            answer2, _ = self._split_parts(resp2)
            log_event(request_id, agent, "repair_call", raw=answer2)
            try:
                return schema.model_validate(_extract_json(answer2))
            except (ValueError, ValidationError) as err2:
                raise AgentError(f"{agent} produced invalid output twice: {err2}") from err2


_client: GeminiClient | None = None


def get_client() -> GeminiClient:
    """Lazy singleton so we don't construct a client (or read the key) at import time."""
    global _client
    if _client is None:
        _client = GeminiClient()
    return _client
