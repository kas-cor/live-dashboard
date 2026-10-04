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
  assert.ok(markup.includes('Сброс лимита использования'));
  assert.ok(markup.includes('Открыть настройки использования'));
  assert.ok(markup.includes('href="https://chatgpt.com/"'));

  const selectors = [
    '.codex-plan-line', '.codex-window-title-primary', '.codex-fill-primary',
    '.codex-value-primary', '.usage-reset-primary', '.codex-window-title-secondary',
    '.codex-fill-secondary', '.codex-value-secondary', '.usage-reset-secondary',
    '.codex-credits',
  ];
  const nodes = new Map(selectors.map((selector) => [selector, {
    innerHTML: '', textContent: '', style: {}, classList: { add() {}, remove() {} },
  }]));
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
  Date.now = () => fixedNowMs;
  global.fetch = async () => ({ json: async () => ({
    plan: 'plus',
    limit_reached: false,
    windows: {
      primary: {
        used_percent: 6, window_seconds: 18_000,
        reset_at: fixedNowSec + 3_600, reset_in_seconds: 9_000,
      },
      secondary: {
        used_percent: 3, window_seconds: 604_800,
        reset_at: fixedNowSec + 86_400, reset_in_seconds: 86_400,
      },
    },
    credits: { has_credits: false, unlimited: false, balance: '0' },
  }) });
  try {
    await widget.update();
  } finally {
    Date.now = realNow;
    global.fetch = realFetch;
  }

  assert.ok(nodes.get('.usage-reset-primary').textContent.startsWith('Сброс через 1 ч 0 мин · '));
  assert.ok(nodes.get('.usage-reset-secondary').textContent.startsWith('Сброс через 1 д 0 ч · '));
  assert.strictEqual(nodes.get('.codex-window-title-primary').textContent, 'Лимит на 5 ч');
  assert.strictEqual(nodes.get('.codex-window-title-secondary').textContent, 'Недельный лимит');
  console.log('codex-usage: reset countdown and action link OK');
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
