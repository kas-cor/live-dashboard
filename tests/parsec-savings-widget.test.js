const assert = require('assert');
const path = require('path');

global.window = {};
global.BaseWidget = class {
  constructor(id, options) { this.id = id; this.options = options; }
  setError(message) { this.error = message; }
};

require(path.join(__dirname, '..', 'assets', 'js', 'widgets', 'parsec-savings.js'));
const Widget = global.window.ParsecSavingsWidget;

async function testDisplaysVerbatimOutputAsText() {
  const output = {
    textContent: '',
    attributes: {},
    setAttribute(name, value) { this.attributes[name] = value; },
  };
  const stamp = { textContent: '' };
  const widget = new Widget('parsec-savings', { apiUrl: '/api/parsec-savings' });
  widget.element = {
    querySelector(selector) {
      return selector === '.parsec-savings-output' ? output : stamp;
    },
  };

  const cliOutput = 'proxy ledger: 2 requests\n  <script>not markup</script>';
  global.fetch = async (url, options) => {
    assert.strictEqual(url, '/api/parsec-savings');
    assert.strictEqual(options.cache, 'no-store');
    return {
      ok: true,
      json: async () => ({ output: cliOutput, generated_at: '2026-11-09T12:00:00+03:00' }),
    };
  };

  await widget.update();
  assert.strictEqual(output.textContent, cliOutput);
  assert.strictEqual(output.attributes['aria-busy'], 'false');
  assert.ok(stamp.textContent);
}

async function testReportsUnavailableCommand() {
  const output = {
    textContent: '',
    setAttribute() {},
  };
  const widget = new Widget('parsec-savings', {});
  widget.element = { querySelector: () => output };
  global.fetch = async () => ({ ok: true, json: async () => ({ error: 'parsec_savings_unavailable' }) });

  await widget.update();
  assert.match(widget.error, /parsec_savings_unavailable/);
  assert.match(output.textContent, /не удалось/i);
}

(async () => {
  await testDisplaysVerbatimOutputAsText();
  await testReportsUnavailableCommand();
  console.log('parsec-savings widget: ok (2/2)');
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
