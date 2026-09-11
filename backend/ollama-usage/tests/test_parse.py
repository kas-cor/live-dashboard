#!/usr/bin/env python3
"""Тесты парсера ollama-usage: разметка free (проценты) и pro/max (деньги).

Запуск:  python3 backend/ollama-usage/tests/test_parse.py

Инвариант: процент берётся из aria-label, а на платных тарифах — из ширины
заливки трека, плюс абсолютный расход из денежного aria-label.
"""
import importlib.util
import os
import sys
import unittest

SCRIPT = os.path.join(
    os.path.dirname(os.path.abspath(__file__)), "..", "scripts", "ollama-usage.py"
)


def _load_module():
    spec = importlib.util.spec_from_file_location("ollama_usage", SCRIPT)
    assert spec and spec.loader
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


mod = _load_module()

PRO_HTML = """
<h2 class="text-xl font-medium flex items-center space-x-2">
  <span>Included usage</span>
  <span class="text-xs font-normal px-2 py-0.5 rounded-full bg-neutral-100 text-neutral-600 capitalize"
    >pro</span
  >
</h2>
<div>
  <div class="flex justify-between mb-2">
    <span class="text-sm">Monthly usage</span>
    <span class="text-sm">$1.39 of $60 used</span>
  </div>
  <div class="relative group" data-usage-meter>
    <div class="relative h-3 overflow-hidden rounded-full bg-neutral-200"
      data-usage-track
      aria-label="Monthly usage $1.39 of $60 used">
      <div class="flex h-full overflow-hidden bg-neutral-950" style="width: 2.3%; ">
        <button type="button" style="width: 100%; background: #3b82f6"
          data-usage-segment data-model="glm-5.3-flash" data-requests="224"></button>
      </div>
    </div>
  </div>
  <div class="text-xs text-neutral-500 mt-1 local-time" data-time="2026-10-10T19:49:02Z">
    Resets in 4 weeks.
  </div>
</div>
"""

FREE_HTML = """
<h2 class="text-xl font-medium flex items-center space-x-2">
  <span>Included usage</span>
  <span class="text-xs font-normal px-2 py-0.5 rounded-full bg-neutral-100 text-neutral-600 capitalize"
    >free</span
  >
</h2>
<div>
  <div class="flex justify-between mb-2">
    <span class="text-sm">Monthly usage</span>
    <span class="text-sm">3% used</span>
  </div>
  <div class="relative group" data-usage-meter>
    <div class="relative h-3 overflow-hidden rounded-full bg-neutral-200"
      data-usage-track
      aria-label="Monthly usage 3% used">
      <div class="flex h-full overflow-hidden bg-neutral-950" style="width: 3%; ">
        <button type="button" style="width: 100%; background: #3b82f6"
          data-usage-segment data-model="nemotron-3-super" data-requests="5"></button>
      </div>
    </div>
  </div>
  <div class="text-xs text-neutral-500 mt-1 local-time" data-time="2026-10-04T05:11:16Z">
    Resets in 3 weeks.
  </div>
</div>
"""


class TestProMarkup(unittest.TestCase):
    """Платный тариф: aria-label в деньгах, процент только в ширине заливки."""

    def setUp(self):
        self.u = mod.parse_usage(PRO_HTML)["usage"]

    def test_percent_from_fill_width(self):
        self.assertEqual(self.u["percent"], 2.3)

    def test_absolute_amounts(self):
        self.assertEqual(self.u["used"], 1.39)
        self.assertEqual(self.u["limit"], 60.0)
        self.assertEqual(self.u["currency"], "$")

    def test_reset_and_models(self):
        self.assertEqual(self.u["resets_at"], "2026-10-10T19:49:02Z")
        self.assertEqual(self.u["models"][0]["model"], "glm-5.3-flash")
        self.assertEqual(self.u["models"][0]["requests"], 224)


class TestFreeMarkup(unittest.TestCase):
    """Free-тариф: процент в aria-label, абсолютных значений нет."""

    def setUp(self):
        self.u = mod.parse_usage(FREE_HTML)["usage"]

    def test_percent_from_aria(self):
        self.assertEqual(self.u["percent"], 3.0)

    def test_no_amounts(self):
        self.assertIsNone(self.u["used"])
        self.assertIsNone(self.u["limit"])
        self.assertIsNone(self.u["currency"])


class TestPlanAndAmounts(unittest.TestCase):
    def test_plan_badges(self):
        self.assertEqual(mod.parse_usage(PRO_HTML)["plan"], "pro")
        self.assertEqual(mod.parse_usage(FREE_HTML)["plan"], "free")

    def test_parse_amount_formats(self):
        self.assertEqual(mod._parse_amount("1.39"), 1.39)
        self.assertEqual(mod._parse_amount("1,39"), 1.39)
        self.assertEqual(mod._parse_amount("1,234.56"), 1234.56)
        self.assertEqual(mod._parse_amount("1.234,56"), 1234.56)
        self.assertIsNone(mod._parse_amount("abc"))


class TestDepletionProjection(unittest.TestCase):
    """Прогноз исчерпания пула по среднему расходу за прошедший период."""

    NOW = "2026-09-11T00:00:00Z"

    def test_projects_before_reset(self):
        # 20% за 3 дня (осталось 27д из 30) → 6.67%/день → 80% хватит на 12д,
        # то есть пул кончится до сброса → прогноз есть и он раньше сброса.
        resets = "2026-10-08T00:00:00Z"  # через 27 дней
        got = mod._project_depletion(20.0, resets, self.NOW)
        self.assertIsNotNone(got)
        self.assertLess(got, resets)

    def test_none_exactly_at_boundary(self):
        # 10% за 3 дня → 3.33%/день → 90% хватит ровно на 27д = момент сброса.
        # Пул не исчерпается до сброса → прогноза нет.
        self.assertIsNone(
            mod._project_depletion(10.0, "2026-10-08T00:00:00Z", self.NOW)
        )

    def test_none_when_outlasts_period(self):
        # 1% за 3 дня → пул не успеет кончиться до сброса
        self.assertIsNone(mod._project_depletion(1.0, "2026-10-08T00:00:00Z", self.NOW))

    def test_none_without_inputs(self):
        self.assertIsNone(mod._project_depletion(0.0, "2026-10-08T00:00:00Z", self.NOW))
        self.assertIsNone(mod._project_depletion(10.0, None, self.NOW))
        self.assertIsNone(mod._project_depletion(10.0, "not-a-date", self.NOW))

    def test_exhausted_returns_now(self):
        got = mod._project_depletion(100.0, "2026-10-08T00:00:00Z", self.NOW)
        self.assertEqual(got, self.NOW)

    def test_early_period_is_aggressive(self):
        # 5% за ~0.5 дня → 10%/день → исчерпание примерно через 9.5 дней
        resets = "2026-10-10T12:00:00Z"  # через 29.5 дней
        got = mod._project_depletion(5.0, resets, self.NOW)
        self.assertIsNotNone(got)
        self.assertTrue(got.startswith("2026-09-20"))


if __name__ == "__main__":
    unittest.main(verbosity=2)
