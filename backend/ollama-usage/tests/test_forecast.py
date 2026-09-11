#!/usr/bin/env python3
"""Тесты ядра прогноза `ollama_forecast`: тарифы, peak-веса, границы цикла,
приоритет абсолютного расхода над процентом, фильтр токенов по first_seen.

Запуск:  python3 backend/ollama-usage/tests/test_forecast.py

Инварианты, от которых зависит прогноз исчерпания пула:
  1. price_for находит тариф по имени, тегу и :cloud-суффиксу.
  2. weighted_cost даёт цену между off-peak и peak для моделей с надбавкой.
  3. shift_month уходит назад через границу года и не ломается на 31-м числе.
  4. build_forecast предпочитает абсолютные $ округлённому проценту.
  5. collect_cycle_tokens фильтрует по first_seen (кумулятив не течёт в цикл).
  6. annotate_models переводит долю трека в абсолютный расход.
"""
import importlib.util
import os
import sqlite3
import sys
import tempfile
import unittest
from datetime import datetime, timezone

SCRIPTS = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "scripts")


def _load(name, filename):
    spec = importlib.util.spec_from_file_location(name, os.path.join(SCRIPTS, filename))
    assert spec and spec.loader
    mod = importlib.util.module_from_spec(spec)
    sys.modules[name] = mod
    spec.loader.exec_module(mod)
    return mod


fc = _load("ollama_forecast", "ollama_forecast.py")


class TestPrices(unittest.TestCase):
    def test_exact_name(self):
        p = fc.price_for("deepseek-v4.1-flash")
        self.assertIsNotNone(p)
        self.assertEqual(p["off"][0], 0.15)

    def test_tagged_name(self):
        self.assertEqual(fc.price_for("deepseek-v4-flash:0731")["off"][0], 0.22)

    def test_cloud_suffix(self):
        p = fc.price_for("deepseek-v4.1-flash:cloud")
        self.assertIsNotNone(p)
        self.assertEqual(p["off"][2], 0.60)

    def test_unknown_returns_none(self):
        for bad in ("неизвестная", "", None):
            self.assertIsNone(fc.price_for(bad))

    def test_peak_only_for_deepseek(self):
        self.assertEqual(fc.price_for("glm-5.3-flash")["off"],
                         fc.price_for("glm-5.3-flash")["peak"])
        self.assertNotEqual(fc.price_for("deepseek-v4.1-flash")["off"],
                            fc.price_for("deepseek-v4.1-flash")["peak"])


class TestWeightedCost(unittest.TestCase):
    def test_zero_tokens(self):
        cost, parts = fc.weighted_cost(0, 0, 0, fc.price_for("glm-5.3-flash"))
        self.assertEqual((cost, parts), (0.0, (0.0, 0.0, 0.0)))

    def test_flat_price_model(self):
        """glm без peak-надбавки: 1M входа = ровно $0.15."""
        cost, _ = fc.weighted_cost(1_000_000, 0, 0, fc.price_for("glm-5.3-flash"))
        self.assertAlmostEqual(cost, 0.15, places=6)

    def test_peak_share_between_bounds(self):
        p = fc.price_for("deepseek-v4.1-flash")
        cost, _ = fc.weighted_cost(1_000_000, 0, 0, p)
        self.assertGreater(cost, p["off"][0])
        self.assertLess(cost, p["peak"][0])

    def test_parts_sum_to_total(self):
        cost, (ci, co, cc) = fc.weighted_cost(5_000_000, 2_000_000, 10_000_000,
                                              fc.price_for("glm-5.3-flash"))
        self.assertAlmostEqual(ci + co + cc, cost, places=9)

    def test_cache_cheaper_than_input(self):
        p = fc.price_for("glm-5.3-flash")
        c_in, _ = fc.weighted_cost(1_000_000, 0, 0, p)
        c_cache, _ = fc.weighted_cost(0, 0, 1_000_000, p)
        self.assertLess(c_cache, c_in)


class TestShiftMonth(unittest.TestCase):
    def test_back_one_month(self):
        d = datetime(2026, 9, 10, 19, 49, tzinfo=timezone.utc)
        s = fc.shift_month(d, 1)
        self.assertEqual((s.year, s.month), (2026, 8))

    def test_across_year(self):
        s = fc.shift_month(datetime(2026, 1, 15, tzinfo=timezone.utc), 1)
        self.assertEqual((s.year, s.month), (2025, 12))

    def test_short_month_clamped(self):
        s = fc.shift_month(datetime(2026, 3, 31, tzinfo=timezone.utc), 1)
        self.assertEqual((s.year, s.month, s.day), (2026, 2, 28))

    def test_time_preserved(self):
        s = fc.shift_month(datetime(2026, 9, 10, 19, 49, 2, tzinfo=timezone.utc), 1)
        self.assertEqual((s.hour, s.minute, s.second), (19, 49, 2))

    def test_cycle_start_is_previous_month(self):
        reset = datetime(2026, 10, 10, 19, 49, tzinfo=timezone.utc)
        self.assertEqual(fc.cycle_start_for(reset).month, 9)


class TestForecastUsdBasis(unittest.TestCase):
    """Платный тариф: опора на абсолютные $, а не на округлённый процент."""

    USAGE = {"percent": 8.9, "used": 5.34, "limit": 60.0, "currency": "$",
             "resets_at": "2026-10-10T19:49:02Z"}
    NOW = "2026-09-11T15:30:00Z"

    def setUp(self):
        self.r = fc.build_forecast(self.USAGE, self.NOW)

    def test_basis_is_usd(self):
        self.assertEqual(self.r["basis"], "usd")

    def test_elapsed_and_left_days(self):
        self.assertAlmostEqual(self.r["elapsed_days"], 0.82, places=2)
        self.assertAlmostEqual(self.r["left_days"], 29.18, places=1)

    def test_burn_rate(self):
        # 5.34 / 0.82 ≈ 6.5
        self.assertAlmostEqual(self.r["burn_usd_per_day"], 6.51, places=1)

    def test_depletes_before_reset(self):
        self.assertFalse(self.r["lasts_full_cycle"])
        self.assertIsNotNone(self.r["depletes_at"])
        self.assertLess(self.r["depletes_at"], self.USAGE["resets_at"])

    def test_deficit_and_shortfall(self):
        self.assertGreater(self.r["deficit_days"], 0)
        self.assertGreater(self.r["shortfall_usd"], 0)

    def test_reduction_factor(self):
        self.assertGreater(self.r["reduction_factor"], 1.0)
        # burn / sustainable = reduction_factor
        self.assertAlmostEqual(
            self.r["burn_usd_per_day"] / self.r["sustainable_usd_per_day"],
            self.r["reduction_factor"], places=2)

    def test_basis_ignores_percent_when_usd_present(self):
        """Тот же $ расход при другом проценте даёт тот же прогноз."""
        alt = dict(self.USAGE, percent=99.0)
        self.assertEqual(fc.build_forecast(alt, self.NOW)["depletes_at"],
                         self.r["depletes_at"])


class TestForecastPercentBasis(unittest.TestCase):
    """Free-тариф: денег нет, единица — процент пула."""

    USAGE = {"percent": 3.0, "used": None, "limit": None,
             "resets_at": "2026-10-04T05:11:16Z"}

    def test_basis_is_percent(self):
        r = fc.build_forecast(self.USAGE, "2026-09-11T15:30:00Z")
        self.assertEqual(r["basis"], "percent")
        self.assertIsNone(r["burn_usd_per_day"])

    def test_percent_burn(self):
        r = fc.build_forecast(self.USAGE, "2026-09-11T15:30:00Z")
        self.assertGreater(r["burn_pct_per_day"], 0)

    def test_slow_burn_outlasts_period(self):
        r = fc.build_forecast(self.USAGE, "2026-09-11T15:30:00Z")
        self.assertTrue(r["lasts_full_cycle"])
        self.assertIsNone(r["depletes_at"])


class TestForecastEdgeCases(unittest.TestCase):
    def test_no_reset_returns_empty(self):
        r = fc.build_forecast({"percent": 5, "used": 1, "limit": 60}, "2026-09-11T15:30:00Z")
        self.assertIsNone(r["depletes_at"])
        self.assertIsNone(r["burn_usd_per_day"])

    def test_reset_in_past(self):
        r = fc.build_forecast({"percent": 5, "used": 1, "limit": 60,
                               "resets_at": "2026-09-01T00:00:00Z"}, "2026-09-11T15:30:00Z")
        self.assertIsNone(r["depletes_at"])
        self.assertEqual(r["left_days"], 0.0)

    def test_zero_usage_no_projection(self):
        r = fc.build_forecast({"percent": 0, "used": 0, "limit": 60,
                               "resets_at": "2026-10-10T19:49:02Z"}, "2026-09-11T15:30:00Z")
        self.assertIsNone(r["depletes_at"])
        self.assertIsNone(r["burn_usd_per_day"])

    def test_exhausted_marks_now(self):
        r = fc.build_forecast({"percent": 100, "used": 60, "limit": 60,
                               "resets_at": "2026-10-10T19:49:02Z"}, "2026-09-11T15:30:00Z")
        self.assertFalse(r["lasts_full_cycle"])
        self.assertIsNotNone(r["depletes_at"])
        self.assertEqual(r["days_left"], 0.0)

    def test_bad_reset_format(self):
        r = fc.build_forecast({"percent": 5, "used": 1, "limit": 60,
                               "resets_at": "not-a-date"}, "2026-09-11T15:30:00Z")
        self.assertIsNone(r["depletes_at"])

    def test_parse_iso_handles_z_and_bad(self):
        self.assertIsNotNone(fc.parse_iso("2026-10-10T19:49:02Z"))
        self.assertIsNone(fc.parse_iso("нет"))
        self.assertIsNone(fc.parse_iso(None))


class TestCycleTokensFilter(unittest.TestCase):
    """Фильтр first_seen: долгоживущая сессия не тащит кумулятив в цикл."""

    def setUp(self):
        self.tmp = tempfile.NamedTemporaryFile(suffix=".db", delete=False)
        self.tmp.close()
        con = sqlite3.connect(self.tmp.name)
        con.execute(
            """CREATE TABLE session_model_usage (
                   session_id TEXT, model TEXT, billing_provider TEXT,
                   api_call_count INTEGER, input_tokens INTEGER, output_tokens INTEGER,
                   cache_read_tokens INTEGER, cache_write_tokens INTEGER,
                   first_seen REAL, last_seen REAL)"""
        )
        # A: началась ДО цикла, активна внутри (кумулятив 100M)
        con.execute("INSERT INTO session_model_usage VALUES "
                    "('A','glm-5.3-flash','ollama-cloud',100,100000000,0,0,0,1000.0,5000.0)")
        # B: началась ВНУТРИ цикла
        con.execute("INSERT INTO session_model_usage VALUES "
                    "('B','glm-5.3-flash','ollama-cloud',10,5000000,0,0,0,4000.0,4500.0)")
        # C: другой провайдер
        con.execute("INSERT INTO session_model_usage VALUES "
                    "('C','glm-5.3-flash','nous',10,9000000,0,0,0,4000.0,4500.0)")
        con.commit()
        con.close()

    def tearDown(self):
        os.unlink(self.tmp.name)

    def _collect(self, start, end):
        return fc.collect_cycle_tokens(start, end, profiles_root="/nonexistent",
                                       root_db=self.tmp.name)

    def test_excludes_session_started_before_cycle(self):
        agg = self._collect(2000.0, 6000.0)
        self.assertEqual(agg["glm-5.3-flash"]["in"], 5_000_000)

    def test_excludes_other_provider(self):
        self.assertEqual(self._collect(2000.0, 6000.0)["glm-5.3-flash"]["calls"], 10)

    def test_empty_window(self):
        self.assertEqual(self._collect(6001.0, 7000.0), {})


class TestAnnotateModels(unittest.TestCase):
    def test_share_to_usd(self):
        out = fc.annotate_models(
            [{"model": "glm-5.3-flash", "requests": 566, "percent": 40.3}], 5.65)
        self.assertAlmostEqual(out[0]["cost_usd"], 2.2769, places=3)

    def test_no_used_leaves_none(self):
        out = fc.annotate_models([{"model": "x", "requests": 1, "percent": 50}], None)
        self.assertIsNone(out[0]["cost_usd"])

    def test_empty_and_none(self):
        self.assertEqual(fc.annotate_models([], 5.0), [])
        self.assertEqual(fc.annotate_models(None, 5.0), [])

    def test_original_not_mutated(self):
        src = [{"model": "x", "requests": 1, "percent": 50}]
        fc.annotate_models(src, 10.0)
        self.assertNotIn("cost_usd", src[0])


class TestCostBreakdown(unittest.TestCase):
    def test_breakdown_and_calibration(self):
        tokens = {"glm-5.3-flash": {"in": 1_000_000, "out": 100_000,
                                    "cache": 5_000_000, "calls": 10}}
        b = fc.build_cost_breakdown(tokens, used_usd=1.0)
        self.assertGreater(b["weighted_cost_usd"], 0)
        self.assertAlmostEqual(b["calibration"], 1.0 / b["weighted_cost_usd"], places=2)

    def test_unpriced_model_flagged(self):
        tokens = {"неизвестная": {"in": 1_000_000, "out": 0, "cache": 0, "calls": 1}}
        b = fc.build_cost_breakdown(tokens, used_usd=1.0)
        self.assertFalse(b["models"][0]["priced"])
        self.assertEqual(b["weighted_cost_usd"], 0.0)

    def test_empty_tokens(self):
        self.assertIsNone(fc.build_cost_breakdown({}, 5.0))


if __name__ == "__main__":
    unittest.main(verbosity=2)
