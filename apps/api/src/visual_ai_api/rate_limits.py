"""Small replaceable limiter; production can replace this with an Upstash adapter."""

from __future__ import annotations

from collections import defaultdict
from time import monotonic


class RateLimiter:
    def allow(self, key: str, limit: int, window_seconds: float) -> bool:
        raise NotImplementedError


class NoopRateLimiter(RateLimiter):
    def allow(self, key: str, limit: int, window_seconds: float) -> bool:
        return True


class InMemoryRateLimiter(RateLimiter):
    def __init__(self) -> None:
        self._requests: dict[str, list[float]] = defaultdict(list)

    def allow(self, key: str, limit: int, window_seconds: float) -> bool:
        now = monotonic()
        active = [value for value in self._requests[key] if value > now - window_seconds]
        self._requests[key] = active
        if len(active) >= limit:
            return False
        active.append(now)
        return True
