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
  python3 ollama-usage.py --save-cookie <value>    # сохранить куку

Формат cookie-file: первая строка — значение __Secure-session
"""

import argparse
import json
import os
import re
import sys
import urllib.request
from datetime import datetime, timedelta, timezone

SETTINGS_URL = "https://ollama.com/settings"
COOKIE_NAME = "__Secure-session"
DEFAULT_COOKIE_FILE = os.path.expanduser("~/.hermes/scripts/.ollama-session-cookie")

# Длина месячного пула Included usage. Сброс ("Resets in 4 weeks") —
# начало следующего периода, поэтому прошедшая часть = PERIOD_DAYS − остаток.
PERIOD_DAYS = 30.0


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


def _project_depletion(percent: float, resets_at: str | None,
                       fetched_at: str) -> str | None:
    """Прогноз даты исчерпания пула по среднему расходу за прошедший период.

    Средний расход = percent / прошедшая_доля_периода. Если текущий темп
    не успевает потратить пул до сброса — возвращает None (пул переживёт
    период). Прогноз раньше момента сброса считается валидным, позже — нет.
    """
    if not resets_at or not percent:
        return None
    try:
        reset_dt = datetime.fromisoformat(resets_at.replace("Z", "+00:00"))
        now = datetime.fromisoformat(fetched_at.replace("Z", "+00:00"))
    except ValueError:
        return None

    period_seconds = (reset_dt - now).total_seconds()
    if period_seconds <= 0:
        return None

    # Прошедшая доля периода: пул месячный, сброс — начало следующего.
    elapsed_days = PERIOD_DAYS - period_seconds / 86400.0
    if elapsed_days <= 0:
        return None

    remaining_percent = 100.0 - percent
    if remaining_percent <= 0:
        return now.strftime("%Y-%m-%dT%H:%M:%SZ")

    rate_per_day = percent / elapsed_days  # % пула в день
    if rate_per_day <= 0:
        return None

    days_left = remaining_percent / rate_per_day
    depletes_at = now + timedelta(days=days_left)

    # Прогноз имеет смысл только если пул кончится до сброса
    if depletes_at >= reset_dt:
        return None
    return depletes_at.strftime("%Y-%m-%dT%H:%M:%SZ")


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

    if u.get("depletes_at"):
        lines.append(
            f"Projected depletion: {_format_reset(u['depletes_at'])} "
            f"(at current average rate)"
        )

    if verbose and u["models"]:
        lines.append("")
        for model in sorted(u["models"], key=lambda x: x["percent"], reverse=True):
            lines.append(
                f"  {model['model']}: {model['requests']} requests "
                f"({model['percent']}% of usage)"
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
