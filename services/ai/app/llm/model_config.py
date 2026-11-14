"""The one place that decides which model serves which task.

Nothing else in the service names a model. A task belongs to a tier; a tier is an ordered list of models
(first = primary, the rest = fallbacks, tried in order). Operators change models without a deploy:

  AI_MODELS_ECONOMY="anthropic/claude-haiku-5.5,openai/gpt-6-luna"
  AI_MODELS_STRONG="anthropic/claude-sonnet-5.5,openai/gpt-6.1-terra"
  AI_MODEL_CONFIG_JSON='{"consult.respond": {"models": ["openai/gpt-6.1-terra"], "max_tokens": 1200}}'
"""

import json
import os
from dataclasses import dataclass, replace
from functools import lru_cache

# Defaults chosen from the live OpenRouter catalogue on 2026-11-14 (all support structured outputs).
DEFAULT_TIERS: dict[str, tuple[str, ...]] = {
    # Simple, high-volume work: intent extraction, field extraction.
    "economy": ("anthropic/claude-haiku-5.5", "openai/gpt-6-luna", "deepseek/deepseek-v4.1-flash"),
    # Consultation reasoning and customer-facing Arabic copy.
    "strong": ("anthropic/claude-sonnet-5.5", "openai/gpt-6.1-terra", "google/gemini-3.8-flash"),
}


@dataclass(frozen=True)
class TaskConfig:
    task: str
    tier: str
    models: tuple[str, ...]
    max_tokens: int
    # None = do not send one. Current Anthropic and OpenAI models reject the parameter, and with
    # require_parameters OpenRouter then skips them entirely (verified live 2026-11-14).
    temperature: float | None
    timeout_s: float


# task -> (tier, max_tokens, temperature, timeout seconds)
_TASKS: dict[str, tuple[str, int, float | None, float]] = {
    "consult.understand": ("economy", 900, None, 25.0),
    "consult.respond": ("strong", 1800, None, 45.0),
    "guidance.legacy": ("strong", 2000, None, 45.0),
    "enrichment.product": ("economy", 2000, None, 30.0),
    "content.generate": ("economy", 3500, None, 45.0),
}


def _env_models(name: str) -> tuple[str, ...] | None:
    raw = os.getenv(name, "").strip()
    if not raw:
        return None
    models = tuple(m.strip() for m in raw.split(",") if m.strip())
    return models or None


@lru_cache
def _resolved() -> dict[str, TaskConfig]:
    tiers = dict(DEFAULT_TIERS)
    for tier in list(tiers):
        override = _env_models(f"AI_MODELS_{tier.upper()}")
        if override:
            tiers[tier] = override

    configs = {
        task: TaskConfig(task=task, tier=tier, models=tiers[tier], max_tokens=max_tokens, temperature=temp, timeout_s=timeout)
        for task, (tier, max_tokens, temp, timeout) in _TASKS.items()
    }

    raw = os.getenv("AI_MODEL_CONFIG_JSON", "").strip()
    if raw:
        try:
            overrides = json.loads(raw)
        except json.JSONDecodeError as exc:
            raise RuntimeError(f"AI_MODEL_CONFIG_JSON is not valid JSON: {exc}") from exc
        if not isinstance(overrides, dict):
            raise RuntimeError("AI_MODEL_CONFIG_JSON must be an object keyed by task name")
        for task, patch in overrides.items():
            if task not in configs or not isinstance(patch, dict):
                raise RuntimeError(f"AI_MODEL_CONFIG_JSON names an unknown task: {task}")
            current = configs[task]
            models = patch.get("models")
            configs[task] = replace(
                current,
                models=tuple(str(m) for m in models) if isinstance(models, list) and models else current.models,
                max_tokens=int(patch.get("max_tokens", current.max_tokens)),
                temperature=float(patch["temperature"]) if patch.get("temperature") is not None else current.temperature,
                timeout_s=float(patch.get("timeout_s", current.timeout_s)),
            )
    return configs


def task_config(task: str) -> TaskConfig:
    configs = _resolved()
    if task not in configs:
        raise KeyError(f"No model configuration for task '{task}'")
    return configs[task]


def all_task_configs() -> list[TaskConfig]:
    return list(_resolved().values())


def reset_model_config_cache() -> None:
    _resolved.cache_clear()
