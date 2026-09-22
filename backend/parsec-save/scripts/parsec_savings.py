#!/usr/bin/env python3
"""Parsec ledger -> savings report for the live dashboard widget.

Read-only over ``~/.parsec/ledger.jsonl`` (one JSON row per billed request).
Same arithmetic as the reference dollariser in the ``parsec-proxy-ops`` skill:

    tokens saved = counterfactual_input - (billed_input + cache_read)
    cost saved   = tokens saved x input price
    cost         = billed_input x input + cache_read x cached_input
                   + billed_output x output          (Ollama prices cache writes $0)

Rows whose ``counterfactual_input_tokens`` is null are **unmeasured** (they
predate the count_tokens fix) and never contribute to savings -- they are only
counted, so the widget can show how much of the window is unmeasured.

Peak pricing (12:00-18:00 UTC, Mon-Fri) is picked per request from that row's
own UTC timestamp when the model appears in the peak table.

Usable as a library (``compute(ledger, prices)``) or as a CLI::

    python3 parsec_savings.py                       # 24h table
    python3 parsec_savings.py --window 7d --json    # one window, JSON
    python3 parsec_savings.py --all-windows --json  # every window in one pass
"""
import argparse
import datetime as dt
import json
import os

HERE = os.path.dirname(os.path.abspath(__file__))
DEFAULT_LEDGER = os.environ.get("PARSEC_LEDGER", os.path.expanduser("~/.parsec/ledger.jsonl"))
DEFAULT_PRICES = os.environ.get("PARSEC_PRICES", os.path.join(HERE, "ollama_prices.json"))

# (key, hours) -- hours == 0 means "everything in the ledger"
WINDOWS = (("24h", 24), ("7d", 24 * 7), ("all", 0))
TS_FMT = "%Y-%m-%dT%H:%M:%SZ"


def utcnow():
    return dt.datetime.now(dt.timezone.utc)


def iso(when):
    return None if when is None else when.strftime(TS_FMT)


def parse_ts(ts):
    return dt.datetime.strptime(ts, TS_FMT).replace(tzinfo=dt.timezone.utc)


def load_prices(path=DEFAULT_PRICES):
    with open(path) as fh:
        return json.load(fh)


def price_for(prices, model, when):
    """(price dict or None, 'peak'|'std'|'?') for one row."""
    standard = prices.get("standard", {}).get(model)
    peak = prices.get("peak", {}).get(model)
    if standard is None and peak is None:
        return None, "?"
    is_peak = when is not None and when.weekday() < 5 and 12 <= when.hour < 18
    if is_peak and peak is not None:
        return peak, "peak"
    return (standard or peak), "std"


def _slot():
    return {"requests": 0, "measured_requests": 0, "unmeasured_requests": 0,
            "peak_requests": 0, "tokens_saved": 0, "counterfactual_in": 0,
            "usd_saved": 0.0, "billed_in": 0, "cache_read": 0, "cache_write": 0,
            "output": 0, "usd_cost": 0.0, "priced": False, "models": {}}


def _pct(part, whole):
    return round(100.0 * part / whole, 1) if whole else 0.0


def _finish(slot):
    """Totals + derived percentages for one window bucket."""
    slot["usd_saved"] = round(slot["usd_saved"], 6)
    slot["usd_cost"] = round(slot["usd_cost"], 6)
    slot["tokens_saved"] = int(slot["tokens_saved"])
    slot["saved_pct_of_counterfactual"] = _pct(slot["tokens_saved"], slot["counterfactual_in"])
    slot["usd_saved_share_pct"] = _pct(slot["usd_saved"], slot["usd_saved"] + slot["usd_cost"])
    slot["unpriced_models"] = sorted(
        m for m, s in slot["models"].items() if s["requests"] and not s["priced"])
    models = []
    for name, s in slot["models"].items():
        row = {"model": name}
        row.update({k: v for k, v in s.items() if k != "models"})
        row["usd_saved"] = round(row["usd_saved"], 6)
        row["usd_cost"] = round(row["usd_cost"], 6)
        row["saved_pct_of_counterfactual"] = _pct(row["tokens_saved"], row["counterfactual_in"])
        models.append(row)
    models.sort(key=lambda r: (-r["usd_saved"], -r["requests"]))
    slot["models"] = models
    return slot


def compute(ledger_path=DEFAULT_LEDGER, prices_path=DEFAULT_PRICES, windows=WINDOWS,
            now=None, model_filter=None):
    """One pass over the ledger -> {'generated_at', 'ledger', 'prices', 'windows'}."""
    prices = load_prices(prices_path)
    now = now or utcnow()
    cutoff = {name: (now - dt.timedelta(hours=hours) if hours else None)
              for name, hours in windows}
    buckets = {name: _slot() for name, _ in windows}
    rows_total = rows_bad = rows_unmeasured_total = 0
    first_ts = last_ts = None

    with open(ledger_path, errors="replace") as fh:
        for line in fh:
            line = line.strip()
            if not line:
                continue
            try:
                row = json.loads(line)          # a half-written last line fails here
            except ValueError:
                rows_bad += 1
                continue
            rows_total += 1

            model = row.get("model") or "?"
            if model_filter and model != model_filter:
                continue
            ts = row.get("ts") or ""
            try:
                when = parse_ts(ts) if ts else None
            except ValueError:
                when = None
            if when is not None:
                first_ts = ts if first_ts is None or ts < first_ts else first_ts
                last_ts = ts if last_ts is None or ts > last_ts else last_ts

            billed_in = row.get("billed_input_tokens") or 0
            cache_read = row.get("billed_cache_read_tokens") or 0
            cache_write = row.get("billed_cache_write_tokens") or 0
            output = row.get("billed_output_tokens") or 0
            cf = row.get("counterfactual_input_tokens")
            if cf is None:
                rows_unmeasured_total += 1
            price, kind = price_for(prices, model, when)

            for name, _hours in windows:
                cut = cutoff[name]
                if cut is not None and (when is None or when < cut):
                    continue
                slot = buckets[name]
                m = slot["models"].setdefault(model, {"requests": 0, "measured_requests": 0,
                                                      "unmeasured_requests": 0, "peak_requests": 0,
                                                      "tokens_saved": 0, "counterfactual_in": 0,
                                                      "usd_saved": 0.0, "billed_in": 0,
                                                      "cache_read": 0, "cache_write": 0,
                                                      "output": 0, "usd_cost": 0.0,
                                                      "priced": False})
                for target in (slot, m):
                    target["requests"] += 1
                    target["billed_in"] += billed_in
                    target["cache_read"] += cache_read
                    target["cache_write"] += cache_write
                    target["output"] += output
                    if price:
                        target["priced"] = True
                        target["usd_cost"] += (
                            billed_in * price["input"]
                            + cache_read * price["cached_input"]
                            + output * price["output"]
                        ) / 1e6
                    if kind == "peak":
                        target["peak_requests"] += 1
                    if cf is None:
                        target["unmeasured_requests"] += 1
                    else:
                        saved = cf - (billed_in + cache_read)
                        target["measured_requests"] += 1
                        target["tokens_saved"] += saved
                        target["counterfactual_in"] += cf
                        if price:
                            target["usd_saved"] += saved * price["input"] / 1e6

    out = {}
    for name, hours in windows:
        slot = _finish(buckets[name])
        slot["hours"] = hours
        slot["since"] = iso(cutoff[name])
        out[name] = slot

    return {
        "generated_at": iso(now),
        "ledger": {"path": ledger_path, "rows": rows_total, "unparsable": rows_bad,
                   "unmeasured_total": rows_unmeasured_total,
                   "first_ts": first_ts, "last_ts": last_ts},
        "prices": {"source": prices.get("source"), "unit": prices.get("unit"),
                   "peak_window_utc": prices.get("peak_window_utc")},
        "windows": out,
    }


def format_tokens(n):
    if n is None:
        return "?"
    neg = n < 0
    n = abs(n)
    for limit, suffix in ((1e9, "B"), (1e6, "M"), (1e3, "k")):
        if n >= limit:
            return ("-" if neg else "") + ("%.2f%s" % (n / limit, suffix))
    return ("-" if neg else "") + str(int(n))


def print_table(win, name):
    t = win["totals"] if "totals" in win else win
    print("parsec savings · window %s%s" % (
        name, " (since %s)" % win["since"] if win.get("since") else ""))
    print("%-22s %6s %12s %11s %11s %12s %12s" % (
        "Model", "Req", "Tok saved", "Saved $", "Cost $", "Cache read", "Output"))
    for r in t["models"]:
        print("%-22s %6d %12s %11s %11s %12s %12s" % (
            r["model"][:22], r["requests"], format_tokens(r["tokens_saved"]),
            "$%.2f" % r["usd_saved"], "$%.2f" % r["usd_cost"],
            format_tokens(r["cache_read"]), format_tokens(r["output"])))
    print("%-22s %6d %12s %11s %11s %12s %12s" % (
        "TOTAL", t["requests"], format_tokens(t["tokens_saved"]),
        "$%.2f" % t["usd_saved"], "$%.2f" % t["usd_cost"],
        format_tokens(t["cache_read"]), format_tokens(t["output"])))
    print("saved %.1f%% of the counterfactual prompt · offsets %.1f%% of what "
          "this traffic would otherwise cost" % (
              t["saved_pct_of_counterfactual"], t["usd_saved_share_pct"]))
    if t["unmeasured_requests"]:
        print("unmeasured rows in window: %d (no counterfactual -> excluded from savings)"
              % t["unmeasured_requests"])
    if t["unpriced_models"]:
        print("no prices for: " + ", ".join(t["unpriced_models"]))


def main():
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--window", default="24h", choices=[name for name, _ in WINDOWS])
    ap.add_argument("--ledger", default=DEFAULT_LEDGER)
    ap.add_argument("--prices", default=DEFAULT_PRICES)
    ap.add_argument("--model", default=None)
    ap.add_argument("--json", action="store_true")
    ap.add_argument("--all-windows", action="store_true",
                    help="--json: emit all windows (what the dashboard endpoint uses)")
    args = ap.parse_args()

    if args.all_windows:
        windows = WINDOWS
    else:
        hours = dict(WINDOWS)[args.window]
        windows = ((args.window, hours),)
    data = compute(args.ledger, args.prices, windows=windows, model_filter=args.model)
    if args.json:
        print(json.dumps(data, indent=2, sort_keys=True))
        return
    win = data["windows"][args.window]
    print_table({"totals": win, "since": win["since"]}, args.window)


if __name__ == "__main__":
    main()
