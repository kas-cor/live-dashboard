const assert = require('assert');
const path = require('path');

global.window = {};
global.BaseWidget = class {
  constructor(id, options) {
    this.id = id;
    this.options = options || {};
    this._defaultConfig = {};
  }
  getConfig(key, fallback) { return this._defaultConfig[key] ?? fallback; }
};

require(path.join(__dirname, '..', 'assets', 'js', 'widgets', 'sites.js'));
const widget = new global.window.SitesWidget('sites', {});

const unknown = widget.buildSiteRow({ url: 'https://site.example', status: 0, online: null }, true);
assert.ok(unknown.includes('status-unknown'));
assert.ok(!unknown.includes('site-row-error'));
assert.ok(!unknown.includes('site-error'));
assert.ok(unknown.includes('?'));

const offline = widget.buildSiteRow({ url: 'https://site.example', status: 503, online: false }, true);
assert.ok(offline.includes('status-offline'));
assert.ok(offline.includes('site-row-error'));

console.log('site-status-widget: unknown is neutral; HTTP failure remains red');
