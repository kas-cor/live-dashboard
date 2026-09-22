#!/usr/bin/env python3
"""Unit tests for the parsec savings aggregator (stdlib only).

    python3 -m unittest discover -s backend/parsec-save/tests -v
    python3 backend/parsec-save/scripts/parsec_savings.py --help
"""
import datetime as dt
import json
import os
import sys
import tempfile
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
SCRIPTS = os.path.join(HERE, os.pardir, "scripts")
sys.path.insert(0, os.path.abspath(SCRIPTS))

import parsec_savings as ps  # noqa: E402

PRICES = {
    "source": "test",
    "unit": "usd_per_1m_tokens",
    "peak_window_utc": "12:00-18:00 Mon-Fri",
    "standard": {"m1": {"input": 1.0, "cached_input": 0.1, "output": 2.0}},
    "peak": {"m1": {"input": 2.0, "cached_input": 0.2, "output": 4.0}},
}


def row(ts, model="m1", cf=1000, b_in=400, cache_r=100, cache_w=0, out=50):
    return {"ts": ts, "model": model, "counterfactual_input_tokens": cf,
            "billed_input_tokens": b_in, "billed_cache_read_tokens": cache_r,
            "billed_cache_write_tokens": cache_w, "billed_output_tokens": out}


class ParsecSavingsTest(unittest.TestCase):
    def setUp(self):
        self.dir = tempfile.mkdtemp(prefix="parsec-savings-test-")
        self.ledger = os.path.join(self.dir, "ledger.jsonl")
        self.prices = os.path.join(self.dir, "prices.json")
        with open(self.prices, "w") as fh:
            json.dump(PRICES, fh)

    def write(self, rows, tail=None):
        with open(self.ledger, "w") as fh:
            for r in rows:
                fh.write(json.dumps(r) + "\n")
            if tail is not None:
                fh.write(tail)  # simulate a half-written last line

    def compute(self, rows, **kw):
        self.write(rows, tail=kw.pop("tail", None))
        return ps.compute(self.ledger, self.prices, **kw)

    def test_offpeak_maths(self):
        """tokens saved = cf - (billed + cache_read); cost uses 3 separate prices."""
        now = dt.datetime(2026, 1, 6, 9, 0, tzinfo=dt.timezone.utc)  # Tue 09:00 -> std
        data = self.compute([row("2026-01-06T08:30:00Z")], now=now,
                            windows=(("24h", 24),))
        t = data["windows"]["24h"]
        self.assertEqual(t["requests"], 1)
        self.assertEqual(t["tokens_saved"], 1000 - (400 + 100))
        self.assertEqual(t["unmeasured_requests"], 0)
        self.assertAlmostEqual(t["usd_saved"], 500 * 1.0 / 1e6, places=9)
        self.assertAlmostEqual(
            t["usd_cost"], (400 * 1.0 + 100 * 0.1 + 50 * 2.0) / 1e6, places=9)
        self.assertEqual(t["peak_requests"], 0)
        self.assertTrue(t["priced"])

    def test_peak_window_double_price(self):
        now = dt.datetime(2026, 1, 6, 13, 0, tzinfo=dt.timezone.utc)
        data = self.compute([row("2026-01-06T12:30:00Z")], now=now,
                            windows=(("24h", 24),))
        t = data["windows"]["24h"]
        self.assertEqual(t["peak_requests"], 1)
        self.assertAlmostEqual(t["usd_saved"], 500 * 2.0 / 1e6, places=9)
        self.assertAlmostEqual(
            t["usd_cost"], (400 * 2.0 + 100 * 0.2 + 50 * 4.0) / 1e6, places=9)

    def test_peak_window_is_weekday_only(self):
        """Saturday 13:00 UTC is outside the peak window -> standard rates."""
        now = dt.datetime(2026, 1, 10, 14, 0, tzinfo=dt.timezone.utc)  # Sat
        data = self.compute([row("2026-01-10T13:00:00Z")], now=now,
                            windows=(("24h", 24),))
        self.assertEqual(data["windows"]["24h"]["peak_requests"], 0)

    def test_null_counterfactual_is_unmeasured(self):
        now = dt.datetime(2026, 1, 6, 9, 0, tzinfo=dt.timezone.utc)
        data = self.compute([row("2026-01-06T08:30:00Z", cf=None)], now=now,
                            windows=(("24h", 24),))
        t = data["windows"]["24h"]
        self.assertEqual(t["unmeasured_requests"], 1)
        self.assertEqual(t["measured_requests"], 0)
        self.assertEqual(t["tokens_saved"], 0)
        self.assertEqual(t["usd_saved"], 0.0)
        self.assertAlmostEqual(t["usd_cost"], (400 * 1.0 + 100 * 0.1 + 50 * 2.0) / 1e6,
                               places=9)

    def test_windows_cut_off(self):
        now = dt.datetime(2026, 1, 8, 12, 0, tzinfo=dt.timezone.utc)
        rows = [row("2026-01-08T11:00:00Z"),   # inside 24h
                row("2026-01-05T11:00:00Z"),   # inside 7d only
                row("2025-12-01T11:00:00Z")]   # all only
        data = self.compute(rows, now=now)
        self.assertEqual(data["windows"]["24h"]["requests"], 1)
        self.assertEqual(data["windows"]["7d"]["requests"], 2)
        self.assertEqual(data["windows"]["all"]["requests"], 3)
        self.assertEqual(data["windows"]["all"]["tokens_saved"], 3 * 500)

    def test_halfwritten_line_ignored(self):
        now = dt.datetime(2026, 1, 6, 9, 0, tzinfo=dt.timezone.utc)
        data = self.compute([row("2026-01-06T08:30:00Z")], now=now,
                            windows=(("24h", 24),),
                            tail='{"ts": "2026-01-06T08:31:00Z", "model": "m1"')
        self.assertEqual(data["windows"]["24h"]["requests"], 1)
        self.assertEqual(data["ledger"]["rows"], 1)
        self.assertEqual(data["ledger"]["unparsable"], 1)

    def test_unpriced_model_is_visible(self):
        now = dt.datetime(2026, 1, 6, 9, 0, tzinfo=dt.timezone.utc)
        data = self.compute([row("2026-01-06T08:30:00Z", model="nope")], now=now,
                            windows=(("24h", 24),))
        t = data["windows"]["24h"]
        self.assertEqual(t["unpriced_models"], ["nope"])
        self.assertEqual(t["usd_cost"], 0.0)
        self.assertEqual(t["tokens_saved"], 500)  # tokens still counted
        self.assertEqual(t["usd_saved"], 0.0)

    def test_percentages_and_model_rows(self):
        now = dt.datetime(2026, 1, 6, 9, 0, tzinfo=dt.timezone.utc)
        data = self.compute([row("2026-01-06T08:30:00Z")], now=now,
                            windows=(("24h", 24),))
        t = data["windows"]["24h"]
        self.assertEqual(len(t["models"]), 1)
        self.assertEqual(t["models"][0]["model"], "m1")
        self.assertAlmostEqual(t["saved_pct_of_counterfactual"], 50.0, places=6)
        self.assertAlmostEqual(
            t["usd_saved_share_pct"],
            round(100 * t["usd_saved"] / (t["usd_saved"] + t["usd_cost"]), 1), places=6)


if __name__ == "__main__":
    unittest.main(verbosity=2)
