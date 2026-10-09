const assert = require('assert');
const path = require('path');

global.window = {};
global.BaseWidget = class {
  constructor(id, options) {
    this.id = id;
    this.options = options || {};
    this.element = { innerHTML: '' };
  }
};

require(path.join(__dirname, '..', 'assets', 'js', 'widgets', 'codex-usage.js'));
const Widget = global.window.CodexUsageWidget;

async function main() {
  const widget = new Widget('codex-usage', { apiUrl: '/api/codex-usage' });
  widget.render();
  const markup = widget.element.innerHTML;
  assert.ok(!markup.includes('Сброс лимита использования'));
  assert.ok(!markup.includes('Открыть настройки использования'));
  assert.ok(markup.includes('usage-reset-primary'));
  assert.ok(markup.includes('usage-forecast-primary'));
  assert.ok(markup.includes('usage-forecast-secondary'));
  assert.ok(markup.includes('codex-reset-credits'));

  const selectors = [
    '.codex-plan-line', '.codex-window-title-primary', '.codex-fill-primary',
    '.codex-value-primary', '.usage-reset-primary', '.codex-window-title-secondary',
    '.codex-fill-secondary', '.codex-value-secondary', '.usage-reset-secondary',
    '.usage-forecast-primary', '.usage-forecast-secondary',
    '.codex-credits', '.codex-reset-credits',
  ];
  const nodes = new Map(selectors.map((selector) => {
    const classes = new Set();
    return [selector, {
      innerHTML: '', textContent: '', style: {},
      classList: {
        add: (...items) => items.forEach((item) => classes.add(item)),
        remove: (...items) => items.forEach((item) => classes.delete(item)),
        contains: (item) => classes.has(item),
      },
    }];
  }));
  const body = { querySelector: (selector) => nodes.get(selector) || null };
  const lastUpdate = { textContent: '' };
  widget.element = {
    querySelector: (selector) => selector === '.widget-body' ? body
      : selector === '.last-update' ? lastUpdate : null,
  };

  const fixedNowMs = 1_800_000_000_000;
  const fixedNowSec = fixedNowMs / 1000;
  const realNow = Date.now;
  const realFetch = global.fetch;
  const originalStorage = Object.getOwnPropertyDescriptor(global, 'localStorage');
  const storage = new Map();
  Object.defineProperty(global, 'localStorage', {
    configurable: true,
    value: {
      getItem: (key) => storage.get(key) || null,
      setItem: (key, value) => storage.set(key, value),
    },
  });
  Date.now = () => fixedNowMs;
  let snapshot = {
    reset_credits: { available_count: 1, applicable_available_count: 0,
      credits: [{ id: 'credit-1', type: 'weekly', status: 'available', issued_at: '2026-10-01',
        expires_at: '2026-10-08', description: 'Bonus reset' }] },
    plan: 'plus',
    fetched_at: new Date(fixedNowMs).toISOString(),
    limit_reached: false,
    windows: {
      primary: {
        used_percent: 60, window_seconds: 18_000,
        reset_at: fixedNowSec + 7_200, reset_in_seconds: 7_200,
      },
      secondary: {
        used_percent: 20, window_seconds: 604_800,
        reset_at: fixedNowSec + 86_400, reset_in_seconds: 86_400,
      },
    },
    credits: { has_credits: false, unlimited: false, balance: '0' },
  };
  global.fetch = async () => ({ json: async () => snapshot });
  try {
    await widget.update();
    assert.strictEqual(nodes.get('.usage-forecast-primary').textContent, 'Недостаточно истории о расходе');
    snapshot = {
      reset_credits: { available_count: 1, applicable_available_count: 0,
        credits: [{ id: 'credit-1', type: 'weekly', status: 'available', issued_at: '2026-10-01',
          expires_at: '2026-10-08', description: 'Bonus reset' }] },
      plan: 'plus',
      fetched_at: new Date(fixedNowMs + 3_600_000).toISOString(),
      limit_reached: false,
      windows: {
        primary: {
          used_percent: 90, window_seconds: 18_000,
          reset_at: fixedNowSec + 7_200, reset_in_seconds: 3_600,
        },
        secondary: {
          used_percent: 21, window_seconds: 604_800,
          reset_at: fixedNowSec + 86_400, reset_in_seconds: 82_800,
        },
      },
      credits: { has_credits: false, unlimited: false, balance: '0' },
    };
    Date.now = () => fixedNowMs + 3_600_000;
    await widget.update();
    assert.strictEqual(
      widget._usageForecast('primary', { used_percent: 101, reset_at: fixedNowSec + 7_200 }, fixedNowMs + 3_600_000, fixedNowMs + 3_600_000, () => 'time'),
      'Некорректный процент использования',
    );
    assert.strictEqual(
      widget._usageForecast('primary', { used_percent: 90, reset_at: fixedNowSec + 7_200 }, fixedNowMs + 4_000_000, fixedNowMs + 3_600_000, () => 'time'),
      'Время снимка из будущего',
    );
    assert.strictEqual(
      widget._usageForecast('primary', { used_percent: 90, reset_at: fixedNowSec + 7_200 }, fixedNowMs + 3_500_000, fixedNowMs + 3_600_000, () => 'time'),
      'Получен более старый снимок расхода',
    );
    storage.set('codex-usage-history-v1-future', JSON.stringify([
      { at: fixedNowMs + 280_000, used: 30, resetAt: fixedNowSec + 7_200 },
    ]));
    assert.strictEqual(
      widget._usageForecast('future', { used_percent: 20, reset_at: fixedNowSec + 7_200 }, fixedNowMs + 180_000, fixedNowMs, () => 'time'),
      'Получен более старый снимок расхода',
    );

    const withoutReset = { used_percent: 20, window_seconds: 604_800 };
    assert.strictEqual(
      widget._usageForecast('unknown-reset', withoutReset, fixedNowMs, fixedNowMs, () => 'time'),
      'Недостаточно истории о расходе',
    );
    assert.strictEqual(
      widget._usageForecast('unknown-reset', { ...withoutReset, used_percent: 50 }, fixedNowMs + 3_600_000, fixedNowMs + 3_600_000,
        (secs) => `${Math.floor(secs / 3600)} ч ${Math.floor((secs % 3600) / 60)} мин`),
      'Лимита хватит примерно на 1 ч 40 мин при текущем темпе',
    );
    assert.strictEqual(
      widget._usageForecast('primary', { used_percent: 10, reset_at: fixedNowSec + 7_200 }, fixedNowMs + 4_000_000, fixedNowMs + 4_000_000, () => 'time'),
      'Недостаточно истории о расходе',
    );
    assert.strictEqual(
      widget._usageForecast('primary', { used_percent: 11, reset_at: fixedNowSec + 7_201 }, fixedNowMs + 5_000_000, fixedNowMs + 5_000_000, () => 'time'),
      'Недостаточно истории о расходе',
    );
  } finally {
    Date.now = realNow;
    global.fetch = realFetch;
    if (originalStorage) Object.defineProperty(global, 'localStorage', originalStorage);
    else delete global.localStorage;
  }

  assert.ok(nodes.get('.usage-reset-primary').textContent.startsWith('Сброс через 1 ч 0 мин · '));
  assert.ok(nodes.get('.usage-reset-secondary').textContent.startsWith('Сброс через 23 ч 0 мин · '));
  assert.ok(nodes.get('.usage-forecast-primary').textContent.startsWith('Не хватит: лимит закончится примерно через 20 мин'));
  assert.ok(nodes.get('.usage-forecast-primary').classList.contains('is-warn'));
  assert.ok(nodes.get('.usage-forecast-secondary').textContent.startsWith('Хватит: лимит закончится примерно через 3 д 7 ч'));
  assert.ok(nodes.get('.usage-forecast-secondary').classList.contains('is-ok'));
  assert.strictEqual(
    nodes.get('.codex-reset-credits').textContent,
    'Сбросы: доступно 1 · применимо сейчас 0\ncredit-1 · weekly · available · выдан: 2026-10-01 · истекает: 2026-10-08 · Bonus reset',
  );
  assert.strictEqual(
    widget._usageForecast('primary', { used_percent: 90, reset_at: fixedNowSec + 7_200 }, null, fixedNowMs, () => 'time'),
    'Нет времени снимка для оценки темпа',
  );
  assert.strictEqual(nodes.get('.codex-window-title-primary').textContent, 'Лимит на 5 ч');
  assert.strictEqual(nodes.get('.codex-window-title-secondary').textContent, 'Недельный лимит');
  console.log('codex-usage: reset countdown and forecast OK');
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
