#!/usr/bin/env python3
"""Refresh ollama_prices.json from https://ollama.com/pricing.

Ollama's page carries two tables, both "$ per million tokens":
  1. standard rates      2. "Peak pricing" (12:00-18:00 UTC, Mon-Fri)

Rows whose price is a range (a "-" instead of a plain $-value) are skipped and
reported, so nothing is silently invented. Run:  python3 fetch_ollama_prices.py
"""
import html
import json
import os
import re
import urllib.request

URL = "https://ollama.com/pricing"
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "ollama_prices.json")


def parse_rows(chunk):
    rates = {}
    for row in re.findall(r"<tr>(.*?)</tr>", chunk, re.S):
        name = re.search(r"/library/([a-z0-9._-]+)", row)
        if not name:
            continue
        cells = re.findall(r"<td[^>]*>(.*?)</td>", row, re.S)
        prices = [re.sub(r"[^0-9.]", "", html.unescape(c)) for c in cells[1:4]]
        if len(prices) != 3 or not all(prices):
            continue  # range pricing ("$0.60 - $3.60") -> leave it out
        rates[name.group(1)] = {
            "input": float(prices[0]),
            "cached_input": float(prices[1]),
            "output": float(prices[2]),
        }
    return rates


def parse(page):
    split = page.find("Peak pricing")
    if split < 0:
        return [parse_rows(page), {}]
    return [parse_rows(page[:split]), parse_rows(page[split:])]


def main():
    with urllib.request.urlopen(URL, timeout=30) as resp:
        page = resp.read().decode("utf-8", "replace")
    tables = parse(page)
    standard = tables[0] if tables else {}
    peak = tables[1] if len(tables) > 1 else standard
    data = {
        "source": URL,
        "unit": "usd_per_million_tokens",
        "peak_window_utc": "12:00-18:00 Mon-Fri",
        "standard": standard,
        "peak": peak,
    }
    with open(OUT, "w") as fh:
        json.dump(data, fh, indent=2, sort_keys=True)
        fh.write("\n")
    print("models: standard=%d peak=%d -> %s" % (len(standard), len(peak), OUT))


if __name__ == "__main__":
    main()
