#!/usr/bin/env python3
"""Cross-check the widget's numbers against the reference dollariser.

`parsec_cost.py` (skill ``parsec-proxy-ops``, used by the 22:00 Telegram digest)
is the source of truth. This script runs it and ``parsec_savings.py`` over the
same window and fails if the totals disagree — the widget and the digest must
never tell two different stories.

    python3 backend/parsec-save/tests/verify_vs_reference.py            # 24h
    python3 backend/parsec-save/tests/verify_vs_reference.py --hours 168

Exit code 0 = totals match, 1 = mismatch or the reference is unavailable.
"""
import argparse
import json
import os
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
SCRIPTS = os.path.abspath(os.path.join(HERE, os.pardir, "scripts"))
DEFAULT_REFERENCE = os.path.expanduser(
    "~/.hermes/profiles/hermesa/skills/devops/parsec-proxy-ops/scripts/parsec_cost.py")

FIELDS = (("req", "requests"), ("tok_saved", "tokens_saved"), ("usd_saved", "usd_saved"),
          ("usd", "usd_cost"), ("cache_r", "cache_read"), ("out", "output"))


def run(cmd):
    proc = subprocess.run(cmd, capture_output=True, text=True)
    if proc.returncode != 0:
        print("FAILED: %s\n%s" % (" ".join(cmd), proc.stderr.strip()), file=sys.stderr)
        sys.exit(1)
    return json.loads(proc.stdout)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--hours", type=float, default=24)
    ap.add_argument("--reference", default=os.environ.get("PARSEC_REFERENCE", DEFAULT_REFERENCE))
    ap.add_argument("--prices", default=os.path.join(SCRIPTS, "ollama_prices.json"))
    ap.add_argument("--ledger", default=os.path.expanduser("~/.parsec/ledger.jsonl"))
    args = ap.parse_args()

    if not os.path.exists(args.reference):
        print("SKIP: reference dollariser not found at %s" % args.reference)
        return 1

    window = "24h" if args.hours <= 24 else ("7d" if args.hours <= 168 else "all")
    mine = run([sys.executable, os.path.join(SCRIPTS, "parsec_savings.py"),
                "--window", window, "--json", "--ledger", args.ledger, "--prices", args.prices])
    theirs = run([sys.executable, args.reference, "--hours", str(args.hours), "--json"])

    t = mine["windows"][window]
    ref = {k: 0 for k in ("req", "tok_saved", "usd_saved", "in", "cache_r", "cache_w", "out", "usd")}
    for slot in theirs.values():
        for k in ref:
            ref[k] += slot.get(k) or 0

    print("window %s · hours=%g" % (window, args.hours))
    bad = []
    for ref_key, mine_key in FIELDS:
        a, b = ref[ref_key], t[mine_key]
        if isinstance(a, float) or isinstance(b, float):
            ok = round(a, 4) == round(float(b), 4)
        else:
            ok = a == b
        # dollars are compared at the cent, like both reports print them
        shown_a = "$%.2f" % a if "usd" in ref_key else a
        shown_b = "$%.2f" % b if mine_key in ("usd_saved", "usd_cost") else b
        print("  %-12s mine=%-16s reference=%-16s %s" % (
            mine_key, shown_b, shown_a, "ok" if ok else "MISMATCH"))
        if not ok:
            bad.append(mine_key)

    if bad:
        print("MISMATCH in: " + ", ".join(bad))
        return 1
    print("totals match the reference implementation")
    return 0


if __name__ == "__main__":
    sys.exit(main())
