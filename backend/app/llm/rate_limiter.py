"""Thread-safe token-bucket rate limiter + daily cap.

Rate limits are the real constraint on a free-tier multi-agent system, not scale. This
guards the per-minute budget (token bucket) and the per-day budget (counter), so we
throttle ourselves *before* Gemini returns 429s.
"""
from __future__ import annotations

import threading
import time


class RateLimitExceeded(Exception):
    """Raised when the per-day cap is hit (no point waiting — fail fast and clearly)."""


class RateLimiter:
    def __init__(self, rpm: int, rpd: int):
        self.capacity = float(rpm)
        self.tokens = float(rpm)
        self.refill_per_sec = rpm / 60.0
        self.updated = time.monotonic()

        self.rpd = rpd
        self.day = time.strftime("%Y-%m-%d")
        self.day_count = 0

        self.lock = threading.Lock()

    def acquire(self) -> None:
        """Block until a request token is available; raise if the daily cap is reached."""
        while True:
            with self.lock:
                today = time.strftime("%Y-%m-%d")
                if today != self.day:                 # new day -> reset daily counter
                    self.day, self.day_count = today, 0
                if self.day_count >= self.rpd:
                    raise RateLimitExceeded(
                        f"Daily request cap reached ({self.rpd}). Try again tomorrow or upgrade tier."
                    )

                now = time.monotonic()
                self.tokens = min(
                    self.capacity, self.tokens + (now - self.updated) * self.refill_per_sec
                )
                self.updated = now

                if self.tokens >= 1.0:
                    self.tokens -= 1.0
                    self.day_count += 1
                    return
                wait = (1.0 - self.tokens) / self.refill_per_sec

            time.sleep(min(wait, 5.0))                 # sleep outside the lock, then retry
