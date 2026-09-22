#!/usr/bin/env python3
"""
Ollama Cloud Usage Checker
Парсит данные об "Included usage" с ollama.com/settings через session cookie.

Внимание: Ollama перевела лимиты на новую модель — вместо старых
Session/Weekly теперь единый месячный пул "Included usage"
(процент за период + дата сброса + модели месяца).

Использование:
  python3 ollama-usage.py                          # краткий вывод
  python3 ollama-usage.py --json                   # JSON
  python3 ollama-usage.py --verbose                # с разбивкой по моделям
  python3 ollama-usage.py --cookie-file <path>     # кука из файла
  python3 ollama-usage.py --cookie <value>         # кука из аргумента
  python3 ollama-usage.py --output-file <path>     # запись JSON в файл
  python3 ollama-usage.py --no-tokens              # без разбора токенов (быстро)
  python3 ollama-usage.py --save-cookie <value>    # сохранить куку

Формат cookie-file: первая строка — значение __Secure-session

Прогноз исчерпания пула считает модуль `ollama_forecast.py` — он же общий
для CLI-отчёта. Виджет дашборда показывает готовые поля из JSON.
"""

import argparse
import json
import os
import re
import sys
import urllib.request
from datetime import datetime, timezone

# Ядро прогноза живёт рядом; импорт по пути файла, чтобы работало
# и при загрузке модуля через importlib (тесты), и при прямом запуске.
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import ollama_forecast as forecast  # noqa: E402

SETTINGS_URL = "https://ollama.com/settings"
COOKIE_NAME = "__Secure-session"
DEFAULT_COOKIE_FILE = os.path.expanduser("~/.hermes/scripts/.ollama-session-cookie")


def fetch_page(url: str, cookie_value: str) -> str:
    """Получает HTML страницы с кукой. Возвращает HTML или вызывает sys.exit(1)."""
    req = urllib.request.Request(url)
    req.add_header("Cookie", f"{COOKIE_NAME}={cookie_value}")
    req.add_header("User-Agent", "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36")
    try:
        with urllib.request.urlopen(req, timeout=15) as resp:
            html = resp.read().decode("utf-8")
    except urllib.error.HTTPError as e:
        if e.code == 401 or e.code == 403:
            print("SESSION_EXPIRED", flush=True)
        else:
            print(f"HTTP_ERROR {e.code}", flush=True)
        sys.exit(1)
    except urllib.error.URLError as e:
        print(f"CONNECTION_ERROR {e.reason}", flush=True)
        sys.exit(1)

    # Проверяем, что мы действительно на странице, а не на логине
    if "Sign in" in html and "Included usage" not in html:
        print("SESSION_EXPIRED", flush=True)
        sys.exit(1)

    return html


def parse_usage(html: str) -> dict:
    """Парсит HTML /settings и возвращает месячный пул Included usage."""
    result = {
        "plan": "unknown",
        "usage": {"percent": 0, "used": None, "limit": None, "currency": None,
                  "resets_at": None, "depletes_at": None, "models": []},
        "fetched_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
    }

    # План (free / pro / max) — бейдж рядом с заголовком "Included usage"
    plan_match = re.search(
        r"capitalize\"\s*>\s*([A-Za-z]+)\s*</span\s*>",
        html,
    )
    if plan_match:
        result["plan"] = plan_match.group(1).lower()

    # Общий процент использованного Included usage за месяц.
    # Разметка зависит от тарифа: free показывает проценты
    # ("... 3% used"), pro — деньги ("Monthly usage $1.39 of $60 used").
    # Инвариант для обоих — ширина заливки трека; проценты берём из неё,
    # а из aria-label дополнительно вытаскиваем абсолютные значения.
    aria_match = re.search(r'data-usage-track\s+aria-label="([^"]*)"', html)
    if aria_match:
        aria = aria_match.group(1)
        pct = re.search(r"([\d.]+)%\s*used", aria)
        if pct:
            result["usage"]["percent"] = round(float(pct.group(1)), 1)
        money = re.search(
            r"([$€£])\s*([\d.,]+)\s+of\s+([$€£])?\s*([\d.,]+)", aria
        )
        if money:
            result["usage"]["currency"] = money.group(1)
            result["usage"]["used"] = _parse_amount(money.group(2))
            result["usage"]["limit"] = _parse_amount(money.group(4))

    # Fallback: процент из ширины заливки трека (тариф-независимо)
    if not result["usage"]["percent"]:
        fill_match = re.search(
            r'data-usage-track[^>]*>\s*<div[^>]*style="width:\s*([\d.]+)%',
            html,
            re.DOTALL,
        )
        if fill_match:
            result["usage"]["percent"] = round(float(fill_match.group(1)), 1)

    # Дата сброса (строка "Resets in ..." с data-time рядом)
    reset_match = re.search(
        r'data-time="([^"]+)"\s*>\s*Resets in',
        html,
    )
    if reset_match:
        result["usage"]["resets_at"] = reset_match.group(1)

    # Модели месяца — сегменты внутри трека (стиль → доля, data-model, data-requests)
    for m in re.finditer(
        r'style="width:\s*([\d.]+)%;[^"]*"\s*data-usage-segment\s*'
        r'data-model="([^"]+)"\s*data-requests="(\d+)"',
        html,
    ):
        result["usage"]["models"].append({
            "model": m.group(2),
            "requests": int(m.group(3)),
            "percent": round(float(m.group(1)), 1),
        })

    result["usage"]["depletes_at"] = _project_depletion(
        percent=result["usage"]["percent"],
        resets_at=result["usage"]["resets_at"],
        fetched_at=result["fetched_at"],
    )

    return result


def enrich_forecast(data: dict, with_tokens: bool = True) -> dict:
    """Дополняет данные прогноза полями расчёта (мутирует и возвращает data).

    В `usage.forecast` кладётся полный разбор: темп в $/день, дефицит,
    коэффициент сокращения, структура стоимости по типам токенов.
    `usage.depletes_at` остаётся для совместимости с виджетом.
    """
    usage = data["usage"]
    usage["forecast"] = forecast.build_forecast(
        usage,
        data["fetched_at"],
        tokens_root=None if not with_tokens else forecast.DEFAULT_PROFILES_ROOT,
    )
    # depletes_at из нового расчёта перекрывает линейную оценку
    usage["depletes_at"] = usage["forecast"].get("depletes_at")
    usage["models"] = forecast.annotate_models(usage.get("models") or [], usage.get("used"))
    return data


def _project_depletion(percent: float, resets_at: str | None,
                       fetched_at: str) -> str | None:
    """Дата исчерпания пула по проценту — тонкая обёртка над ядром прогноза.

    Оставлена для обратной совместимости (её проверяют тесты парсера).
    Вся математика — в `ollama_forecast.build_forecast`; здесь только
    приведение процентного базиса к общей сигнатуре.
    """
    result = forecast.build_forecast(
        {"percent": percent, "used": None, "limit": None, "resets_at": resets_at},
        fetched_at,
    )
    return result.get("depletes_at")


def format_output(data: dict, verbose: bool = False) -> str:
    """Форматирует данные для красивого вывода."""
    u = data["usage"]
    lines = [f"Ollama Cloud Included Usage ({data['plan']} plan)"]
    lines.append("")

    bar = _make_bar(u["percent"])
    reset = _format_reset(u["resets_at"])
    amount = ""
    if u.get("used") is not None and u.get("limit") is not None:
        cur = u.get("currency") or ""
        amount = f" — {cur}{u['used']:g} of {cur}{u['limit']:g}"
    lines.append(f"Included usage: {u['percent']}% used{amount} (resets {reset})")
    lines.append(f"  {bar}")

    fc = u.get("forecast") or {}
    if fc.get("burn_usd_per_day") is not None:
        lines.append(
            f"Burn rate: ${fc['burn_usd_per_day']}/day "
            f"({fc.get('burn_pct_per_day')}%/day) over {fc.get('elapsed_days')}d elapsed"
        )
    if u.get("depletes_at"):
        lines.append(
            f"Projected depletion: {_format_reset(u['depletes_at'])} "
            f"(in {fc.get('days_left')}d at current rate)"
        )
    elif fc.get("lasts_full_cycle"):
        lines.append(f"Projected depletion: pool outlasts the period "
                     f"({fc.get('left_days')}d to reset)")
    if fc.get("deficit_days"):
        lines.append(
            f"⚠ Shortfall: {fc['deficit_days']}d before reset, "
            f"~${fc.get('shortfall_usd')} extra needed; "
            f"cut usage ×{fc.get('reduction_factor')} "
            f"(to ${fc.get('sustainable_usd_per_day')}/day)"
        )

    cb = fc.get("cost_breakdown")
    if cb:
        lines.append("")
        lines.append("Cost by token type (with peak rates):")
        lines.append(f"  input:  {cb['total_in'] / 1e6:.1f}M → ${cb['cost_in_usd']}")
        lines.append(f"  output: {cb['total_out'] / 1e6:.2f}M → ${cb['cost_out_usd']}")
        lines.append(f"  cache:  {cb['total_cache'] / 1e6:.1f}M → ${cb['cost_cache_usd']}")
        lines.append(f"  total:  ${cb['weighted_cost_usd']}")
        if cb.get("calibration"):
            lines.append(f"  calibration vs site: ×{cb['calibration']}")

    if verbose and u["models"]:
        lines.append("")
        for model in sorted(u["models"], key=lambda x: x.get("percent") or 0, reverse=True):
            cost = model.get("cost_usd")
            cost_str = f" — ${cost}" if cost is not None else ""
            lines.append(
                f"  {model['model']}: {model['requests']} requests "
                f"({model['percent']}% of usage){cost_str}"
            )

    return "\n".join(lines)


def _parse_amount(raw: str) -> float | None:
    """Парсит денежную сумму из aria-label ("1.39" / "1,39" / "1,234.56")."""
    s = raw.strip()
    if "," in s and "." in s:
        # Разделитель тысяч — тот, что левее
        if s.rindex(",") < s.rindex("."):
            s = s.replace(",", "")
        else:
            s = s.replace(".", "").replace(",", ".")
    else:
        s = s.replace(",", ".")
    try:
        return float(s)
    except ValueError:
        return None


def _make_bar(percent: float, width: int = 40) -> str:
    filled = round(percent / 100 * width)
    empty = width - filled
    return "█" * filled + "░" * empty + f" {percent}%"


def _format_reset(iso_time: str | None) -> str:
    if not iso_time:
        return "unknown"
    try:
        dt = datetime.fromisoformat(iso_time.replace("Z", "+00:00"))
        now = datetime.now(timezone.utc)
        diff = dt - now
        total_seconds = int(diff.total_seconds())
        if total_seconds <= 0:
            return "now"
        days = total_seconds // 86400
        hours = (total_seconds % 86400) // 3600
        minutes = (total_seconds % 3600) // 60
        if days > 0:
            return f"in {days}d {hours}h" if hours else f"in {days}d"
        if hours > 0:
            return f"in {hours}h {minutes}m" if minutes else f"in {hours}h"
        return f"in {minutes}m"
    except ValueError:
        return iso_time


def read_cookie_from_file(path: str) -> str:
    """Читает куку из файла (первая строка)."""
    try:
        with open(path) as f:
            return f.read().strip()
    except FileNotFoundError:
        print(f"❌ Файл с кукой не найден: {path}")
        sys.exit(1)


def save_cookie(path: str, value: str):
    """Сохраняет куку в файл."""
    os.makedirs(os.path.dirname(path) or ".", exist_ok=True)
    with open(path, "w") as f:
        f.write(value.strip() + "\n")
    os.chmod(path, 0o600)
    print(f"✅ Кука сохранена в {path}")


def main():
    parser = argparse.ArgumentParser(description="Ollama Cloud Usage Checker")
    parser.add_argument("--json", action="store_true", help="Вывод в JSON")
    parser.add_argument("--verbose", "-v", action="store_true", help="Разбивка по моделям")
    parser.add_argument("--cookie", type=str, help="Значение __Secure-session куки")
    parser.add_argument("--cookie-file", type=str, help="Файл с кукой")
    parser.add_argument("--save-cookie", type=str, metavar="VALUE",
                        help="Сохранить куку в файл и выйти")
    parser.add_argument("--save-path", type=str, default=DEFAULT_COOKIE_FILE,
                        help=f"Путь для сохранения куки (по умолч.: {DEFAULT_COOKIE_FILE})")
    parser.add_argument("--output-file", type=str,
                        help="Записать JSON в файл (для дашборда)")
    parser.add_argument("--no-tokens", action="store_true",
                        help="Не разбирать токены из state.db (быстрее)")

    args = parser.parse_args()

    # Режим сохранения куки
    if args.save_cookie:
        save_cookie(args.save_path, args.save_cookie)
        return

    # Получаем куку
    cookie = None
    if args.cookie:
        cookie = args.cookie
    elif args.cookie_file:
        cookie = read_cookie_from_file(args.cookie_file)
    else:
        # Пробуем файл по умолчанию
        if os.path.exists(DEFAULT_COOKIE_FILE):
            cookie = read_cookie_from_file(DEFAULT_COOKIE_FILE)
        else:
            parser.print_help()
            print("\n❌ Укажите --cookie, --cookie-file, или сохраните куку через --save-cookie")
            sys.exit(1)

    # Получаем и парсим данные
    html = fetch_page(SETTINGS_URL, cookie)
    data = parse_usage(html)
    data = enrich_forecast(data, with_tokens=not args.no_tokens)

    # Режим записи в файл (для дашборда)
    if args.output_file:
        os.makedirs(os.path.dirname(args.output_file) or ".", exist_ok=True)
        with open(args.output_file, "w") as f:
            json.dump(data, f, indent=2, ensure_ascii=False)
        print(f"✅ Данные записаны в {args.output_file}")
        return

    if args.json:
        print(json.dumps(data, indent=2, ensure_ascii=False))
    else:
        print(format_output(data, verbose=args.verbose))


if __name__ == "__main__":
    main()
