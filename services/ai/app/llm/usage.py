"""Process-wide usage ledger: token and cost totals, a per-minute request window and a daily cost ceiling.

This is the operational view of the gateway (what did we spend, on which task and model, how often did it fail).
Per-customer limits are enforced by the ShenaCare API, which records every call it makes in its own database.
"""

import time
from collections import deque
from dataclasses import dataclass, field
from datetime import datetime, timezone
from threading import Lock


@dataclass
class CallUsage:
    prompt_tokens: int = 0
    completion_tokens: int = 0
    cost_usd: float = 0.0


@dataclass
class _Bucket:
    calls: int = 0
    failures: int = 0
    fallbacks: int = 0
    prompt_tokens: int = 0
    completion_tokens: int = 0
    cost_usd: float = 0.0
    latency_ms_total: float = 0.0


@dataclass
class UsageLedger:
    _lock: Lock = field(default_factory=Lock)
    _day: str = ""
    _day_cost: float = 0.0
    _window: deque = field(default_factory=deque)
    _by_task: dict = field(default_factory=dict)
    _by_model: dict = field(default_factory=dict)
    _errors: deque = field(default_factory=lambda: deque(maxlen=25))

    @staticmethod
    def _today() -> str:
        return datetime.now(timezone.utc).strftime("%Y-%m-%d")

    def _roll_day(self) -> None:
        today = self._today()
        if today != self._day:
            self._day = today
            self._day_cost = 0.0

    def admit(self, max_per_minute: int, daily_cost_limit: float) -> str | None:
        """Returns None when a call may proceed, otherwise the reason it may not."""
        now = time.monotonic()
        with self._lock:
            self._roll_day()
            while self._window and now - self._window[0] > 60.0:
                self._window.popleft()
            if len(self._window) >= max_per_minute:
                return "rate_limited"
            if daily_cost_limit > 0 and self._day_cost >= daily_cost_limit:
                return "daily_cost_limit"
            self._window.append(now)
            return None

    def record(self, task: str, model: str, usage: CallUsage, latency_ms: float, *, used_fallback: bool) -> None:
        with self._lock:
            self._roll_day()
            self._day_cost += usage.cost_usd
            for key, table in ((task, self._by_task), (model, self._by_model)):
                bucket = table.setdefault(key, _Bucket())
                bucket.calls += 1
                bucket.fallbacks += 1 if used_fallback else 0
                bucket.prompt_tokens += usage.prompt_tokens
                bucket.completion_tokens += usage.completion_tokens
                bucket.cost_usd += usage.cost_usd
                bucket.latency_ms_total += latency_ms

    def record_failure(self, task: str, kind: str, detail: str) -> None:
        with self._lock:
            self._by_task.setdefault(task, _Bucket()).failures += 1
            self._errors.append({"at": datetime.now(timezone.utc).isoformat(), "task": task, "kind": kind, "detail": detail[:300]})

    def snapshot(self) -> dict:
        def view(table: dict) -> dict:
            return {
                key: {
                    "calls": b.calls,
                    "failures": b.failures,
                    "fallbacks": b.fallbacks,
                    "promptTokens": b.prompt_tokens,
                    "completionTokens": b.completion_tokens,
                    "costUsd": round(b.cost_usd, 6),
                    "avgLatencyMs": round(b.latency_ms_total / b.calls, 1) if b.calls else None,
                }
                for key, b in table.items()
            }

        with self._lock:
            self._roll_day()
            return {
                "day": self._day,
                "dayCostUsd": round(self._day_cost, 6),
                "requestsLastMinute": len(self._window),
                "byTask": view(self._by_task),
                "byModel": view(self._by_model),
                "recentErrors": list(self._errors),
            }

    def reset(self) -> None:
        with self._lock:
            self._day = ""
            self._day_cost = 0.0
            self._window.clear()
            self._by_task.clear()
            self._by_model.clear()
            self._errors.clear()


ledger = UsageLedger()
