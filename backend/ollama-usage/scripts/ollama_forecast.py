#!/usr/bin/env python3
"""Ядро прогноза Ollama Cloud: исчерпание месячного пула + структура стоимости.

Зачем не хватает линейного процента
-----------------------------------
Старый расчёт брал `percent` с сайта и экстраполировал: `(100-percent)/rate`.
Математика та же, но `percent` округлён до 0.1% — в начале периода это даёт
огромную ошибку (реальные 0.14% против показанных 0.1% = ошибка прогноза 40%).
Абсолютные `$ used / $ limit` точнее и уже содержат все типы токенов.

Что добавляется
---------------
* burn rate в $/день и в %/день (по абсолютным деньгам, не по проценту);
* дефицит: сколько дней не хватит и сколько $ недобор до сброса;
* во сколько раз надо сократить расход, чтобы дожить до сброса;
* структура стоимости по типам токенов (вход / выход / кэш) с peak-тарифами;
* распределение $ по моделям — сайт отдаёт доли расхода напрямую.

Тарифы: https://ollama.com/pricing ($ за 1M токенов).
"""
from __future__ import annotations

import glob
import os
import sqlite3
from datetime import datetime, timedelta, timezone

# --- Тарифы ollama.com, $ за 1M токенов: (вход, кэш-вход, выход) ---
# peak — 12:00–18:00 UTC, Пн–Пт (у deepseek ×2); у остальных надбавки нет.
PRICES = {
    "deepseek-v4.1-flash": {"off": (0.15, 0.003, 0.60), "peak": (0.30, 0.006, 1.20)},
    "deepseek-v4-flash:0731": {"off": (0.22, 0.007, 0.66), "peak": (0.44, 0.014, 1.32)},
    "deepseek-v4-flash:preview": {"off": (0.22, 0.007, 0.66), "peak": (0.44, 0.014, 1.32)},
    "deepseek-v4-flash": {"off": (0.22, 0.007, 0.66), "peak": (0.44, 0.014, 1.32)},
    "glm-5.3-flash": {"off": (0.15, 0.03, 0.50), "peak": (0.15, 0.03, 0.50)},
    "glm-5.3": {"off": (1.40, 0.26, 4.40), "peak": (1.40, 0.26, 4.40)},
    "kimi-k2.6": {"off": (0.95, 0.16, 4.00), "peak": (0.95, 0.16, 4.00)},
    "kimi-k3": {"off": (3.00, 0.30, 15.00), "peak": (3.00, 0.30, 15.00)},
    "minimax-m3": {"off": (0.60, 0.12, 2.40), "peak": (0.60, 0.12, 2.40)},
    "gemma4": {"off": (0.14, 0.05, 0.40), "peak": (0.14, 0.05, 0.40)},
    "gpt-oss": {"off": (0.15, 0.014, 0.60), "peak": (0.15, 0.014, 0.60)},
}

# Доля недели в peak-окне: 5 дней × 6 ч = 30 ч из 168 ч.
PEAK_SHARE = 30.0 / 168.0

# Профили Hermes с локальной статистикой токенов.
DEFAULT_PROFILES_ROOT = "/home/hermes/.hermes/profiles"
DEFAULT_ROOT_DB = "/home/hermes/.hermes/state.db"


def parse_iso(value: str | None) -> datetime | None:
    """Разбирает ISO-время с 'Z' в aware datetime (UTC)."""
    if not value:
        return None
    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None


def shift_month(dt: datetime, n: int) -> datetime:
    """Сдвиг на n месяцев назад с защитой от коротких месяцев (31 → 28)."""
    month, year = dt.month - n, dt.year
    while month <= 0:
        month += 12
        year -= 1
    return dt.replace(year=year, month=month, day=min(dt.day, 28))


def cycle_start_for(reset_at: datetime) -> datetime:
    """Начало текущего месячного цикла: тот же день прошлого месяца."""
    return shift_month(reset_at, 1)


def price_for(model: str | None) -> dict | None:
    """Тариф модели; тег после ':' и ':cloud'-суффикс резолвятся по базовому имени."""
    if not model:
        return None
    if model in PRICES:
        return PRICES[model]
    base = model.split(":")[0]
    if base in PRICES:
        return PRICES[base]
    for key, val in PRICES.items():
        if model.startswith(key):
            return val
    return None


def weighted_cost(tokens_in: float, tokens_out: float, tokens_cache: float,
                  price: dict) -> tuple[float, tuple[float, float, float]]:
    """Стоимость с учётом peak-часов. Возвращает (итого, (вход, выход, кэш))."""
    off, peak = price["off"], price["peak"]
    ci = tokens_in / 1e6 * (off[0] * (1 - PEAK_SHARE) + peak[0] * PEAK_SHARE)
    cc = tokens_cache / 1e6 * (off[1] * (1 - PEAK_SHARE) + peak[1] * PEAK_SHARE)
    co = tokens_out / 1e6 * (off[2] * (1 - PEAK_SHARE) + peak[2] * PEAK_SHARE)
    return ci + co + cc, (ci, co, cc)


def db_paths(profiles_root: str = DEFAULT_PROFILES_ROOT,
             root_db: str = DEFAULT_ROOT_DB) -> list[str]:
    """Все state.db: корневой профиль + профили Hermes."""
    paths = [root_db]
    paths += sorted(glob.glob(os.path.join(profiles_root, "*", "state.db")))
    return [p for p in paths if os.path.exists(p)]


def collect_cycle_tokens(start_ts: float, end_ts: float,
                         profiles_root: str = DEFAULT_PROFILES_ROOT,
                         root_db: str = DEFAULT_ROOT_DB) -> dict:
    """Токены ollama-cloud по моделям за окно — по сессиям, начавшимся внутри.

    Фильтр по `first_seen`, а не `last_seen`: `session_model_usage` хранит
    кумулятивную строку на (сессию, модель), поэтому долгоживущая сессия
    принесла бы в текущий цикл расход всех прошлых месяцев.
    """
    agg: dict[str, dict] = {}
    for path in db_paths(profiles_root, root_db):
        try:
            con = sqlite3.connect(f"file:{path}?mode=ro", uri=True)
            cur = con.cursor()
            cur.execute(
                """SELECT model,
                          COALESCE(SUM(input_tokens), 0), COALESCE(SUM(output_tokens), 0),
                          COALESCE(SUM(cache_read_tokens), 0), COALESCE(SUM(api_call_count), 0)
                   FROM session_model_usage
                   WHERE billing_provider = 'ollama-cloud'
                     AND first_seen >= ? AND first_seen < ?
                   GROUP BY model""",
                (start_ts, end_ts),
            )
            for model, ti, to, tc, calls in cur.fetchall():
                if not model:
                    continue
                d = agg.setdefault(model, {"in": 0, "out": 0, "cache": 0, "calls": 0})
                d["in"] += ti or 0
                d["out"] += to or 0
                d["cache"] += tc or 0
                d["calls"] += calls or 0
            con.close()
        except sqlite3.Error:
            continue
    return agg


def build_cost_breakdown(tokens: dict, used_usd: float | None = None) -> dict | None:
    """Структура стоимости по типам токенов и моделям.

    `calibration` — во сколько раз расчётная стоимость отличается от факта
    с сайта: сайт списывает по своим токенам, часть из них локально не
    записывается, поэтому идеального совпадения не бывает.
    """
    if not tokens:
        return None
    models, tot = [], {"in": 0, "out": 0, "cache": 0, "cost": 0.0,
                       "cost_in": 0.0, "cost_out": 0.0, "cost_cache": 0.0}
    for model, d in sorted(tokens.items(), key=lambda kv: -(kv[1]["in"] + kv[1]["cache"])):
        price = price_for(model)
        if price:
            cost, (ci, co, cc) = weighted_cost(d["in"], d["out"], d["cache"], price)
        else:
            cost, ci, co, cc = 0.0, 0.0, 0.0, 0.0
        models.append({
            "model": model,
            "tokens_in": d["in"], "tokens_out": d["out"], "tokens_cache": d["cache"],
            "calls": d["calls"],
            "cost_usd": round(cost, 4),
            "cost_in_usd": round(ci, 4),
            "cost_out_usd": round(co, 4),
            "cost_cache_usd": round(cc, 4),
            "priced": price is not None,
        })
        tot["in"] += d["in"]; tot["out"] += d["out"]; tot["cache"] += d["cache"]
        tot["cost"] += cost
        tot["cost_in"] += ci; tot["cost_out"] += co; tot["cost_cache"] += cc
    return {
        "total_in": tot["in"], "total_out": tot["out"], "total_cache": tot["cache"],
        "weighted_cost_usd": round(tot["cost"], 4),
        "cost_in_usd": round(tot["cost_in"], 4),
        "cost_out_usd": round(tot["cost_out"], 4),
        "cost_cache_usd": round(tot["cost_cache"], 4),
        "calibration": round(used_usd / tot["cost"], 3) if (used_usd and tot["cost"] > 0) else None,
        "models": models,
    }


def build_forecast(usage: dict, fetched_at: str,
                   tokens_root: str | None = None) -> dict:
    """Прогноз исчерпания пула по фактическому расходу за прошедшую часть цикла.

    Опорная величина — абсолютные `$ used` (точнее округлённого процента).
    На free-тарифе, где денег нет, basis='percent' и единица — процент пула.

    Возвращает dict; `depletes_at` = None, если пул переживёт цикл.
    """
    now = parse_iso(fetched_at) or datetime.now(timezone.utc)
    reset_at = parse_iso(usage.get("resets_at"))
    out: dict = {
        "basis": "usd" if usage.get("used") is not None else "percent",
        "burn_usd_per_day": None, "burn_pct_per_day": None,
        "elapsed_days": None, "left_days": None,
        "days_left": None, "depletes_at": None,
        "lasts_full_cycle": None, "deficit_days": None, "shortfall_usd": None,
        "sustainable_usd_per_day": None, "reduction_factor": None,
    }
    if not reset_at:
        return out

    left_days = (reset_at - now).total_seconds() / 86400.0
    if left_days <= 0:
        out["left_days"] = 0.0
        return out
    out["left_days"] = round(left_days, 3)

    cycle_start = cycle_start_for(reset_at)
    elapsed_days = (now - cycle_start).total_seconds() / 86400.0
    if elapsed_days <= 0:
        return out
    out["elapsed_days"] = round(elapsed_days, 3)

    limit = usage.get("limit")
    used = usage.get("used")
    if used is not None and limit:
        spent, pool = float(used), float(limit)
    else:
        # free-тариф: пул в процентах
        spent = float(usage.get("percent") or 0)
        pool = 100.0
    if spent <= 0:
        return out

    remaining = pool - spent
    burn = spent / elapsed_days
    out["burn_usd_per_day"] = round(burn, 4) if out["basis"] == "usd" else None
    out["burn_pct_per_day"] = round(burn / pool * 100, 4)

    if remaining <= 0:
        out.update(days_left=0.0, depletes_at=now.strftime("%Y-%m-%dT%H:%M:%SZ"),
                   lasts_full_cycle=False, deficit_days=round(left_days, 2),
                   shortfall_usd=0.0 if out["basis"] == "usd" else None)
        return out

    days_left = remaining / burn
    depletes_at = now + timedelta(days=days_left)
    lasts = depletes_at >= reset_at
    out["days_left"] = round(days_left, 2)
    out["depletes_at"] = None if lasts else depletes_at.strftime("%Y-%m-%dT%H:%M:%SZ")
    out["lasts_full_cycle"] = lasts
    if not lasts:
        out["deficit_days"] = round(left_days - days_left, 2)
        if out["basis"] == "usd":
            out["shortfall_usd"] = round(burn * left_days - remaining, 2)
        sustainable = remaining / left_days
        out["sustainable_usd_per_day"] = round(sustainable, 4)
        out["reduction_factor"] = round(burn / sustainable, 3) if sustainable > 0 else None
    else:
        out["deficit_days"] = 0.0
        out["shortfall_usd"] = 0.0 if out["basis"] == "usd" else None

    if tokens_root is not None:
        tokens = collect_cycle_tokens(cycle_start.timestamp(), now.timestamp(),
                                      profiles_root=tokens_root)
        breakdown = build_cost_breakdown(tokens, used if out["basis"] == "usd" else None)
        if breakdown:
            out["cost_breakdown"] = breakdown
    return out


def annotate_models(models: list[dict], used_usd: float | None) -> list[dict]:
    """Добавляет к моделям сайта абсолютный расход: доля трека × общий расход."""
    out = []
    for m in models or []:
        item = dict(m)
        pct = m.get("percent") or 0
        item["cost_usd"] = (round(used_usd * pct / 100.0, 4)
                            if used_usd is not None else None)
        out.append(item)
    return out
