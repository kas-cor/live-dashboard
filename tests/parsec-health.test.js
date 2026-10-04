/**
 * Проверка баннера свежести в виджете parsec-save: три состояния payload.health.
 * Запуск: node tests/parsec-health.test.js   (без фреймворков, только assert)
 */
const assert = require('assert');
const path = require('path');

global.window = {};
global.BaseWidget = class {
  constructor(id, options) { this.id = id; this.options = options || {}; }
  setError() {}
};

require(path.join(__dirname, '..', 'assets', 'js', 'widgets', 'parsec-save.js'));
const Widget = global.window.ParsecSaveWidget;

function makeWidget() {
  const health = { hidden: true, className: '', textContent: '' };
  const widget = new Widget('parsec-save', { apiUrl: '/api/parsec-save' });
  widget.element = {
    querySelector: (sel) => (sel === '.parsec-health' ? health : null),
    querySelectorAll: () => [],
  };
  return { widget, health };
}

// 1. всё растёт
let { widget, health } = makeWidget();
widget.data = { health: { available: true, stale: false, ports_total: 6, ports_stale: 0, threshold_minutes: 45, ports: [{ age_minutes: 3.2 }] } };
widget._paintHealth();
assert.strictEqual(health.hidden, false);
assert.strictEqual(health.className, 'parsec-health is-ok');
assert.ok(/растёт/.test(health.textContent), health.textContent);
assert.ok(/6 воркеров/.test(health.textContent), health.textContent);

// 2. воркер замолчал
({ widget, health } = makeWidget());
widget.data = { health: { available: true, stale: true, ports_total: 6, ports_stale: 2, stale_ports: ['18084', '18087'], threshold_minutes: 45, ports: [] } };
widget._paintHealth();
assert.strictEqual(health.className, 'parsec-health is-warn');
assert.ok(/18084, 18087/.test(health.textContent), health.textContent);
assert.ok(/2\/6/.test(health.textContent), health.textContent);

// 3. пул не смонтирован
({ widget, health } = makeWidget());
widget.data = { health: { available: false, reason: '/parsec-pool не смонтирован', stale: false, ports: [] } };
widget._paintHealth();
assert.strictEqual(health.className, 'parsec-health is-warn');
assert.ok(/недоступен/.test(health.textContent), health.textContent);

console.log('parsec-health: ok (3/3)');
