#!/usr/bin/env python3
"""Merge Ollama + OpenAI model prices into one price table for parsec savings.

Sources:
  - Ollama:   ollama_prices.json (this dir) -- maintained by fetch_ollama_prices.py
  - OpenAI:   models.dev catalog (https://models.dev/catalog.json) -- the openai
              provider block; cost.{input,output,cache_read} in $/1M tokens.
              Fetched prices are cached in openai_cache.json so an offline run
              still produces a complete table.

Output: parsec_prices.json with the schema parsec_savings.py expects
(standard/peak tables, unit usd_per_million_tokens). Ollama peak pricing is
kept as-is; OpenAI models have no peak table (always standard).

Run: python3 fetch_prices.py
"""
import json
import os
import sys
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
OLLAMA = os.path.join(HERE, "ollama_prices.json")
CACHE = os.path.join(HERE, "openai_cache.json")
OUT = os.path.join(HERE, "parsec_prices.json")
CATALOG_URL = os.environ.get("MODELS_DEV_URL", "https://models.dev/catalog.json?type=all")

# Manual overrides for models that are not in either source, keyed by the exact
# ledger model name. $0 for genuinely free endpoints.
EXTRA = {
    # free endpoint served by the pool (verified: opencode provider, cost 0)
    "mimo-v2.5-free": {"input": 0.0, "output": 0.0, "cached_input": 0.0},
}


def fetch_openai():
    req = urllib.request.Request(CATALOG_URL, headers={"User-Agent": "hermes-dashboard/1.0"})
    with urllib.request.urlopen(req, timeout=60) as r:
        catalog = json.load(r)
    models = catalog.get("providers", {}).get("openai", {}).get("models", {})
    out = {}
    for mid, m in models.items():
        cost = m.get("cost")
        if not cost or cost.get("input") is None:
            continue  # no numeric pricing (image models etc.)
        out[mid] = {
            "input": float(cost["input"]),
            "output": float(cost.get("output", 0.0)),
            "cached_input": float(cost.get("cache_read", 0.0)),
        }
    return out


def main():
    with open(OLLAMA) as fh:
        ollama = json.load(fh)

    try:
        openai = fetch_openai()
        if not openai:
            raise RuntimeError("catalog had no openai models with cost")
        with open(CACHE, "w") as fh:
            json.dump(openai, fh, indent=2, sort_keys=True)
            fh.write("\n")
        source = ollama.get("source") + " + " + CATALOG_URL
    except Exception as e:
        print(f"warning: catalog fetch failed ({e}); using {CACHE}", file=sys.stderr)
        with open(CACHE) as fh:
            openai = json.load(fh)
        source = ollama.get("source") + " + models.dev (cached)"

    standard = dict(ollama.get("standard", {}))
    standard.update(EXTRA)
    standard.update(openai)

    out = {
        "unit": "usd_per_million_tokens",
        "peak": ollama.get("peak", {}),
        "peak_window_utc": ollama.get("peak_window_utc"),
        "source": source,
        "standard": standard,
    }
    with open(OUT, "w") as fh:
        json.dump(out, fh, indent=2, sort_keys=True)
        fh.write("\n")

    print(f"parsec_prices.json: {len(standard)} models "
          f"(openai={len(openai)}, extra={len(EXTRA)}) -> {OUT}")


if __name__ == "__main__":
    main()
