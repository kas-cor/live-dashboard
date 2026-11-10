const assert = require('assert');
const path = require('path');

global.window = {};
global.BaseWidget = class {
  constructor(id, options) { this.id = id; this.options = options; }
  setError(message) { this.error = message; }
};

require(path.join(__dirname, '..', 'assets', 'js', 'widgets', 'parsec-savings.js'));
const Widget = global.window.ParsecSavingsWidget;

async function testParsesStructuredOutput() {
  const widget = new Widget('parsec-savings', { apiUrl: '/api/parsec-savings' });
  const parsed = widget.parseSavingsOutput([
    'proxy ledger — 2 request(s) / 1 conversation(s):',
    '  input: 100 counterfactual vs 80 billed(+cache) → ~20 tok saved (20.0%)',
    '  cache: 60 read / 0 write (n/a) · freezer trimmed ~2 tok (diagnostic)',
    '    gpt-6-luna: 2 req · 20 tok saved (20.0%) — pricing',
    '    gpt-6.1-terra: 1 req · 5 tok saved (5.0%) — pricing',
    '    gpt-5.5: 1 req · 3 tok saved (3.0%) — pricing',
    '  fail-open: 0 request(s), 1 scorer step(s) · 0 null probe(s) excluded (§8.4)',
  ].join('\n'));
  assert.strictEqual(parsed.summary.totalRequests, 2);
  assert.strictEqual(parsed.models.length, 3);
  assert.strictEqual(parsed.models[0].tokensSaved, 20);
  assert.strictEqual(parsed.input.counterfactualTokens, 100);
  assert.strictEqual(parsed.input.billedTokens, 80);
  const html = widget.renderParsedData(parsed);
  assert.match(html, /parsec-summary-grid/);
  assert.match(html, /parsec-input-summary/);
  assert.match(html, /parsec-cache-grid/);
  assert.match(html, /Cache reads/);
  assert.match(html, /2 req/);
  assert.match(html, /Models \(3\)/);
  assert.strictEqual((html.match(/class="parsec-model-row"/g) || []).length, 3);
  assert.match(html, /parsec-model-list/);
  const rendered = widget.renderParsedData({
    summary: { totalRequests: 1, totalConversations: 1 },
    input: { counterfactualTokens: 10, billedTokens: 5, tokensSaved: 5, savePercent: 10 },
    cache: { reads: 0, writes: 0, freezerTrimmed: 0 },
    models: [{ name: '<script>alert(1)</script>', requests: 1, tokensSaved: 5, savePercent: 10 }],
    failOpen: {},
  });
  assert.match(rendered, /&lt;script&gt;/);
  assert.doesNotMatch(rendered, /<img|<script>/);
}

async function testReportsUnavailableCommand() {
  const output = {
    innerHTML: '<div>Loading</div>',
    setAttribute() {},
  };
  const widget = new Widget('parsec-savings', {});
  widget.element = { querySelector: () => output };
  global.fetch = async () => ({ ok: true, json: async () => ({ error: 'parsec_savings_unavailable' }) });

  await widget.update();
  assert.match(widget.error, /parsec_savings_unavailable/);
  assert.match(output.innerHTML, /Could not load/i);
}

(async () => {
  await testParsesStructuredOutput();
  await testReportsUnavailableCommand();
  console.log('parsec-savings widget: ok (2/2)');
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
