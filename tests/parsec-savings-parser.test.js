const assert = require('assert');
const path = require('path');

global.window = {};
global.BaseWidget = class { constructor(id, options) { this.id = id; this.options = options; } };
require(path.join(__dirname, '..', 'assets', 'js', 'widgets', 'parsec-savings.js'));

const widget = new global.window.ParsecSavingsWidget('parsec-savings', {});
const parsed = widget.parseSavingsOutput([
  'proxy ledger — 12 request(s) / 4 conversation(s):',
  '  input: 1000 counterfactual vs 800 billed(+cache) → ~200 tok saved (20.0%)',
  '    of which 200 tok measured locally',
  '  cache: 600 read / 0 write (n/a) · freezer trimmed ~10 tok (diagnostic)',
  '    gpt-6-luna: 10 req · 200 tok saved (20.0%) — pricing',
  '  fail-open: 0 request(s), 2 scorer step(s) · 0 null probe(s) excluded (§8.4)',
].join('\n'));

assert.strictEqual(parsed.summary.totalRequests, 12);
assert.strictEqual(parsed.input.tokensSaved, 200);
assert.strictEqual(parsed.cache.reads, 600);
assert.strictEqual(parsed.models.length, 1);
assert.strictEqual(parsed.models[0].tokensSaved, 200);
assert.strictEqual(parsed.failOpen.scorerSteps, 2);
console.log('parsec-savings parser: ok');
