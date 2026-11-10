const assert = require('assert');
const path = require('path');

global.window = {};
global.BaseWidget = class {
  constructor(id, options) {
    this.id = id;
    this.options = options || {};
    this._defaultConfig = { maxItems: 15, showPriority: true, showDue: true, filterStatus: 'all' };
  }
  getConfig(key, fallback) { return this._defaultConfig[key] ?? fallback; }
};

require(path.join(__dirname, '..', 'assets', 'js', 'widgets', 'todo.js'));
const Widget = global.window.TodoWidget;

function makeWidget() {
  const list = { innerHTML: '' };
  const count = { textContent: '' };
  const widget = new Widget('todo', {});
  widget.element = { querySelector: (selector) => selector === '#todo-list' ? list : count };
  return { widget, list, count };
}

async function testApiErrorIsNotReportedAsAllDone() {
  const { widget, list, count } = makeWidget();
  global.fetch = async () => ({ ok: true, json: async () => ({ tasks: [], count: 0, pending: 0, error: 'private filesystem path' }) });
  await widget.update();
  assert.match(list.innerHTML, /Tasks are unavailable/);
  assert.doesNotMatch(list.innerHTML, /All done/);
  assert.doesNotMatch(list.innerHTML, /private filesystem path/);
  assert.strictEqual(count.textContent, 'Unavailable');
}

async function testHttpFailureIsVisible() {
  const { widget, list } = makeWidget();
  global.fetch = async () => ({ ok: false, status: 503 });
  await widget.update();
  assert.match(list.innerHTML, /Tasks are unavailable/);
  assert.doesNotMatch(list.innerHTML, /All done/);
}

async function testEmptySuccessMeansAllDone() {
  const { widget, list } = makeWidget();
  global.fetch = async () => ({ ok: true, json: async () => ({ tasks: [], count: 0, pending: 0 }) });
  await widget.update();
  assert.match(list.innerHTML, /All done/);
}

async function testTaskFieldsAreEscaped() {
  const { widget, list } = makeWidget();
  global.fetch = async () => ({ ok: true, json: async () => ({
    tasks: [{ text: '<img src=x onerror=alert(1)>', due: '<b>today</b>', status: 'bad" onclick="x', priority: '<script>' }],
    count: 1,
    pending: 1,
  }) });
  await widget.update();
  assert.match(list.innerHTML, /&lt;img/);
  assert.match(list.innerHTML, /&lt;b&gt;today&lt;\/b&gt;/);
  assert.doesNotMatch(list.innerHTML, /<img|<script|onclick=/);
  assert.match(list.innerHTML, /todo-item pending/);
  assert.match(list.innerHTML, /todo-priority medium/);
}

(async () => {
  await testApiErrorIsNotReportedAsAllDone();
  await testHttpFailureIsVisible();
  await testEmptySuccessMeansAllDone();
  await testTaskFieldsAreEscaped();
  console.log('todo widget: ok (4/4)');
})().catch((error) => { console.error(error); process.exitCode = 1; });
