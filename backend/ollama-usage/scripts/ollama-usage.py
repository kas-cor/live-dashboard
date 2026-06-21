#!/usr/bin/env python3
"""
Ollama Cloud Usage Checker
Парсит данные об использовании с ollama.com/settings через session cookie.

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
from datetime import datetime, timezone

SETTINGS_URL = "https://ollama.com/settings"
BILLING_URL = "https://ollama.com/settings/billing"
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
    if "Sign in" in html and "Cloud usage" not in html and "subscription" not in html.lower():
        print("SESSION_EXPIRED", flush=True)
        sys.exit(1)

    return html


def parse_billing(html: str) -> dict | None:
    """Парсит страницу /settings/billing и возвращает дату окончания подписки."""
    match = re.search(
        r'Your subscription ends on <span[^>]*>([A-Za-z]+ \d+, \d{4})</span>',
        html,
    )
    if match:
        date_str = match.group(1)
        try:
            dt = datetime.strptime(date_str, "%B %d, %Y")
            return {
                "ends_at": dt.strftime("%Y-%m-%d"),
                "ends_at_formatted": date_str,
            }
        except ValueError:
            pass
    return None


def parse_usage(html: str, billing_html: str | None = None) -> dict:
    """Парсит HTML и возвращает структуру с данными об использовании."""

    result = {
        "plan": "unknown",
        "session": {"percent": 0, "resets_at": None, "models": []},
        "weekly": {"percent": 0, "resets_at": None, "models": []},
        "subscription": None,
        "fetched_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
    }

    # План (pro / max / free) — ищем в блоке Cloud usage
    plan_match = re.search(
        r'Cloud usage</span>.*?rounded-full[^>]*>\s*(\w+)\s*</span\s*>',
        html,
        re.DOTALL,
    )
    if plan_match:
        result["plan"] = plan_match.group(1).lower()

    # Session usage percent
    session_pct_match = re.search(
        r'aria-label="Session usage\s+([\d.]+)%\s*used"', html
    )
    if session_pct_match:
        result["session"]["percent"] = round(float(session_pct_match.group(1)), 1)

    # Weekly usage percent
    weekly_pct_match = re.search(
        r'aria-label="Weekly usage\s+([\d.]+)%\s*used"', html
    )
    if weekly_pct_match:
        result["weekly"]["percent"] = round(float(weekly_pct_match.group(1)), 1)

    # Session resets at (data-time атрибут)
    session_time_match = re.search(
        r'Session usage.*?data-time="([^"]+)"', html, re.DOTALL
    )
    if session_time_match:
        result["session"]["resets_at"] = session_time_match.group(1)

    # Weekly resets at
    weekly_time_match = re.search(
        r'Weekly usage.*?data-time="([^"]+)"', html, re.DOTALL
    )
    if weekly_time_match:
        result["weekly"]["resets_at"] = weekly_time_match.group(1)

    # Session per-model breakdown
    session_block = re.search(
        r'Session usage.*?(?=Weekly usage)', html, re.DOTALL
    )
    if session_block:
        for m in re.finditer(
            r'data-model="([^"]+)"[^>]*data-requests="(\d+)"',
            session_block.group(0),
        ):
            result["session"]["models"].append({
                "model": m.group(1),
                "requests": int(m.group(2)),
            })

    # Weekly per-model breakdown
    weekly_block = re.search(r'Weekly usage.*', html, re.DOTALL)
    if weekly_block:
        for m in re.finditer(
            r'data-model="([^"]+)"[^>]*data-requests="(\d+)"',
            weekly_block.group(0),
        ):
            result["weekly"]["models"].append({
                "model": m.group(1),
                "requests": int(m.group(2)),
            })

    # Billing info (subscription end date)
    if billing_html:
        billing = parse_billing(billing_html)
        if billing:
            result["subscription"] = billing

    return result


def format_output(data: dict, verbose: bool = False) -> str:
    """Форматирует данные для красивого вывода."""
    lines = []
    lines.append(f"Ollama Cloud Usage ({data['plan']} plan)")
    lines.append("")

    s = data["session"]
    w = data["weekly"]

    # Session
    session_bar = _make_bar(s["percent"])
    reset_s = _format_reset(s["resets_at"])
    lines.append(f"Session: {s['percent']}% used (resets {reset_s})")
    lines.append(f"  {session_bar}")

    if verbose and s["models"]:
        total_req = sum(m["requests"] for m in s["models"])
        for m in sorted(s["models"], key=lambda x: x["requests"], reverse=True):
            pct = round(m["requests"] / total_req * 100, 1) if total_req else 0
            lines.append(f"  {m['model']}: {m['requests']} requests ({pct}%)")

    lines.append("")

    # Weekly
    weekly_bar = _make_bar(w["percent"])
    reset_w = _format_reset(w["resets_at"])
    lines.append(f"Weekly: {w['percent']}% used (resets {reset_w})")
    lines.append(f"  {weekly_bar}")

    if verbose and w["models"]:
        total_req = sum(m["requests"] for m in w["models"])
        for m in sorted(w["models"], key=lambda x: x["requests"], reverse=True):
            pct = round(m["requests"] / total_req * 100, 1) if total_req else 0
            lines.append(f"  {m['model']}: {m['requests']} requests ({pct}%)")

    return "\n".join(lines)


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
        hours = total_seconds // 3600
        minutes = (total_seconds % 3600) // 60
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
    billing_html = fetch_page(BILLING_URL, cookie)
    data = parse_usage(html, billing_html)

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
