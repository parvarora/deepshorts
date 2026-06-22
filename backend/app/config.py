"""Central configuration, loaded from environment / .env.

Every tunable that affects rate-limit safety, resilience, or prompt location lives
here so the whole system can be reasoned about from one file.
"""
from __future__ import annotations

from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict

_BACKEND_DIR = Path(__file__).resolve().parents[1]   # backend/
_REPO_ROOT = _BACKEND_DIR.parent                      # repo root (holds prompts/)


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=str(_BACKEND_DIR / ".env"),
        env_file_encoding="utf-8",
        extra="ignore",
    )

    # --- Gemini ---
    gemini_api_key: str = ""
    # gemini-2.5-flash: established model with the full free-tier allowance (15 RPM /
    # 1500 RPD). The newer gemini-3.5-flash launched with a far smaller free daily cap
    # (~20/day), which throttled generation, so we default to 2.5-flash. Override via
    # the GEMINI_MODEL env var if you want a different model.
    gemini_model: str = "gemini-2.5-flash"

    # --- Orchestration ---
    max_iterations: int = 2          # critic -> revise loop ceiling (loop guard)
    enable_thinking: bool = True
    temperature: float = 1.0

    # --- Rate limiting / resilience (free tier: 15 RPM, 1500 RPD) ---
    rpm_limit: int = 12
    rpd_limit: int = 1400
    max_retries: int = 5
    request_timeout_s: int = 120

    # --- Paths ---
    prompts_dir: Path = _REPO_ROOT / "prompts"
    log_dir: Path = _BACKEND_DIR / "logs"
    director_images_dir: Path = _REPO_ROOT / "directors"   # <id>.jpg photos for the UI

    # --- CORS ---
    # "*" is fine here: this is a public, unauthenticated, cookie-free API (no user
    # sessions to leak cross-origin). The frontend now calls Cloud Run directly
    # (not through a Firebase Hosting rewrite — see docs/DEPLOY.md), so cross-origin
    # browser requests are the normal case in production, not an edge case.
    cors_origins: list[str] = ["*"]


settings = Settings()
