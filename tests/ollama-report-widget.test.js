const assert = require('assert');
const path = require('path');

global.window = {};
global.BaseWidget = class { constructor(id, options) { this.id = id; this.options = options; } };
require(path.join(__dirname, '..', 'assets', 'js', 'widgets', 'ollama-usage.js'));

async function testUnknownSnapshotDoesNotPretendZeroUsage() {
  const body = { innerHTML: '', querySelector: () => null };
  const widget = new global.window.OllamaUsageWidget('ollama-usage', {});
  widget.element = { querySelector: (selector) => selector === '.widget-body' ? body : null };
  global.fetch = async () => ({ ok: true, json: async () => ({ plan: 'unknown', usage: { percent: 0 } }) });
  await widget.update();
  assert.match(body.innerHTML, /No current included-usage data/);
  assert.doesNotMatch(body.innerHTML, /0%|progress-fill/);
}

async function run() {
  await testCostReportRendersSafely();
  await testUnknownSnapshotDoesNotPretendZeroUsage();
}

async function testCostReportRendersSafely() {
  const body = { innerHTML: '', querySelector: () => null };
  const stamp = { textContent: '' };
  const widget = new global.window.OllamaUsageWidget('ollama-usage', { apiUrl: '/api/ollama-usage' });
  widget.element = { querySelector: (selector) => selector === '.widget-body' ? body : stamp };
  global.fetch = async () => ({
    ok: true,
    json: async () => ({
      fetched_at: '2026-11-10T05:22:00Z',
      report: {
        period: 'Nov 1–10, UTC', total_cost: 0.05, model_cost: 0.04, requests: 24,
        models: [
          { name: '<img src=x onerror=alert(1)>', requests: 24, input: '1.2M', output: '14.8K', cost: 0.04 },
          { name: 'model-2', requests: 10, input: '200K', output: '2K', cost: 0.01 },
          { name: 'model-3', requests: 8, input: '100K', output: '1K', cost: 0.01 },
          { name: 'model-4', requests: 4, input: '50K', output: '500', cost: 0.01 },
          { name: 'model-5', requests: 2, input: '10K', output: '100', cost: 0.01 },
          { name: 'model-6', requests: 1, input: '1K', output: '10', cost: 0.01 },
        ],
      },
    }),
  });
  await widget.update();
  assert.match(body.innerHTML, /Total cost/);
  assert.match(body.innerHTML, /24/);
  assert.match(body.innerHTML, /Models \(6\)/);
  for (const model of ['model-2', 'model-3', 'model-4', 'model-5', 'model-6']) {
    assert.match(body.innerHTML, new RegExp(model));
  }
  assert.match(body.innerHTML, /ollama-report-model-list/);
  assert.match(body.innerHTML, /&lt;img/);
  assert.doesNotMatch(body.innerHTML, /<img/);
  assert.doesNotMatch(body.innerHTML, /progress-fill/);
  assert.ok(stamp.textContent);
  console.log('ollama report widget: ok');
}

run().catch((error) => { console.error(error); process.exitCode = 1; });
