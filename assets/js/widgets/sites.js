class SitesWidget extends BaseWidget {
  constructor(id, options) {
    super(id, options);
    this.size = options.size || 'medium';
    this.apiUrl = options.apiUrl || '/api/site-status';
    this._defaultConfig = {
      title: 'Site Status',
      highlightOffline: true,
      showStatusCode: true,
      alertOfflineEnabled: true,
      sites: []
    };
    this._configSchema = [
      { key: 'title', label: 'Widget title', type: 'text' },
      { key: 'highlightOffline', label: 'Highlight offline sites', type: 'checkbox' },
      { key: 'showStatusCode', label: 'Show error status codes', type: 'checkbox' },
      { key: '_sitesSection', label: '🌐 Monitored sites', type: 'section' },
      { key: '_alertSection', label: 'Мониторинг критических состояний', type: 'section' },
      { key: 'alertOfflineEnabled', label: 'Следить за offline сайтами', type: 'checkbox' }
    ];
  }

  render() {
    const title = this.getConfig('title', this.options.title || 'Site Status');
    this.element.innerHTML = '<div class="widget-header"><h3>' + title + '</h3><div class="widget-header-actions">' + (this.hasSettings() ? '<button class="widget-settings-btn" title="Settings">\u2699</button>' : '') + '</div></div><div class="widget-body" id="sites-' + this.id + '"><div class="site-list"><div class="metric inline"><span class="metric-value">Loading...</span></div></div></div>';
    this.element.classList.add('widget-scroll');
    const btn = this.element.querySelector('.widget-settings-btn');
    if (btn) btn.addEventListener('click', () => this.toggleSettings());
  }

  buildSiteRow(site, withData) {
    const highlightOffline = this.getConfig('highlightOffline', true);
    const showStatusCode = this.getConfig('showStatusCode', true);
    if (!withData) {
      const domain = new URL(site).hostname;
      return '<div class="site-row" data-url="' + site + '"><span class="status-indicator status-unknown"></span><span class="site-domain">' + domain + '</span><span class="site-code"></span></div>';
    }
    const statusClass = site.online ? 'status-online' : 'status-offline';
    const domain = new URL(site.url).hostname;
    const codeText = showStatusCode && !site.online ? ' ' + site.status : '';
    const codeClass = site.online ? '' : 'site-error';
    const rowClass = !site.online && highlightOffline ? ' site-row-error' : '';
    return '<div class="site-row' + rowClass + '" data-url="' + site.url + '"><span class="status-indicator ' + statusClass + '"></span><span class="site-domain ' + codeClass + '">' + domain + '</span><span class="site-code ' + codeClass + '">' + codeText + '</span></div>';
  }

  async update() {
    const title = this.getConfig('title', this.options.title || 'Site Status');
    const h3 = this.element.querySelector('.widget-header h3');
    if (h3) h3.textContent = title;
    let raw;
    try {
      const res = await fetch(this.apiUrl, { cache: 'no-store' });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      raw = await res.json();
    } catch (e) { return; }
    // Handle both old format (array) and new format ({sites, alerts})
    const data = Array.isArray(raw) ? raw : (raw.sites || []);
    const alerts = Array.isArray(raw) ? [] : (raw.alerts || []);
    const list = this.element.querySelector('.site-list');
    if (!list) return;
    list.innerHTML = data.map(s => this.buildSiteRow(s, true)).join('');

    // --- Server-side alerts: backend checks thresholds ---
    if (window.alertManager && alerts.length > 0) {
      for (const alert of alerts) {
        window.alertManager.trigger(alert);
      }
    }
  }

  // --- Custom settings panel with site management ---
  openSettings() {
    if (!this.hasSettings() || !this.element) return;
    const panel = document.createElement('div');
    panel.className = 'widget-settings';
    let html = '<div class="settings-title">Settings</div>';

    // Standard fields
    for (const field of this._configSchema) {
      if (field.type === 'section') {
        html += '<div class="settings-section-title">' + field.label + '</div>';
        continue;
      }
      const val = this.getConfig(field.key, field.default);
      html += '<div class="settings-field">';
      html += '<label class="settings-label">' + field.label + '</label>';
      if (field.type === 'checkbox') {
        html += '<input type="checkbox" class="settings-input" data-key="' + field.key + '"' + (val ? ' checked' : '') + '>';
      } else {
        html += '<input type="text" class="settings-input" data-key="' + field.key + '" value="' + (val || '') + '">';
      }
      html += '</div>';
    }

    // --- Sites list management ---
    html += '<div class="settings-section-title">Manage sites</div>';
    const sites = this.getConfig('sites', []);
    html += '<div class="sites-list-manage" style="max-height:200px;overflow-y:auto;margin-bottom:8px;">';
    if (sites.length === 0) {
      html += '<div style="color:var(--text-secondary);font-size:12px;padding:4px 0;">No sites added yet.</div>';
    } else {
      for (let i = 0; i < sites.length; i++) {
        const domain = new URL(sites[i]).hostname;
        html += '<div class="site-manage-row" style="display:flex;align-items:center;justify-content:space-between;padding:3px 0;border-bottom:1px solid var(--border);font-size:13px;">';
        html += '<span title="' + sites[i] + '">' + domain + '</span>';
        html += '<button class="site-remove-btn" data-index="' + i + '" style="background:none;border:none;color:#ff4444;cursor:pointer;font-size:16px;line-height:1;" title="Remove">&times;</button>';
        html += '</div>';
      }
    }
    html += '</div>';

    // Add site input
    html += '<div class="settings-field" style="border:none;padding:0;margin-top:4px;">';
    html += '<div style="display:flex;gap:4px;">';
    html += '<input type="text" class="sites-add-input" placeholder="https://example.com" style="flex:1;padding:4px 8px;border:1px solid var(--border);border-radius:4px;background:var(--bg);color:var(--text);font-size:13px;">';
    html += '<button class="sites-add-btn" style="padding:4px 10px;background:var(--accent);color:#fff;border:none;border-radius:4px;cursor:pointer;font-size:13px;white-space:nowrap;">+ Add</button>';
    html += '</div>';
    html += '</div>';

    // Save/Cancel
    html += '<div class="settings-actions">';
    html += '<button class="settings-save">Save</button>';
    html += '<button class="settings-cancel">Cancel</button>';
    html += '</div>';
    panel.innerHTML = html;
    this.element.appendChild(panel);
    this._settingsPanel = panel;

    // Add site button handler
    const addInput = panel.querySelector('.sites-add-input');
    const addBtn = panel.querySelector('.sites-add-btn');
    const addSite = () => {
      const url = addInput.value.trim();
      if (!url) return;
      const sites = this.getConfig('sites', []);
      if (!sites.includes(url)) {
        sites.push(url);
        this.config.sites = sites;
      }
      addInput.value = '';
      // Re-render sites list
      this._renderSettingsSites(panel);
    };
    addBtn.addEventListener('click', addSite);
    addInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') addSite(); });

    // Remove site buttons
    panel.querySelectorAll('.site-remove-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const idx = parseInt(btn.dataset.index);
        const sites = this.getConfig('sites', []);
        sites.splice(idx, 1);
        this.config.sites = sites;
        this._renderSettingsSites(panel);
      });
    });

    // Save
    panel.querySelector('.settings-save').addEventListener('click', async () => {
      // Collect standard config fields
      const inputs = panel.querySelectorAll('.settings-input');
      for (const input of inputs) {
        const key = input.dataset.key;
        let value;
        if (input.type === 'checkbox') value = input.checked;
        else if (input.type === 'number') value = parseFloat(input.value);
        else value = input.value;
        await this.setConfig(key, value);
      }
      // Save config which already has updated sites
      await this.saveConfig();
      this.closeSettings();
      this.applyLayout();
      if (this.interval) clearInterval(this.interval);
      this.start();
    });
    panel.querySelector('.settings-cancel').addEventListener('click', () => this.closeSettings());
  }

  _renderSettingsSites(panel) {
    const container = panel.querySelector('.sites-list-manage');
    const sites = this.getConfig('sites', []);
    if (sites.length === 0) {
      container.innerHTML = '<div style="color:var(--text-secondary);font-size:12px;padding:4px 0;">No sites added yet.</div>';
    } else {
      container.innerHTML = sites.map((url, i) => {
        const domain = new URL(url).hostname;
        return '<div class="site-manage-row" style="display:flex;align-items:center;justify-content:space-between;padding:3px 0;border-bottom:1px solid var(--border);font-size:13px;">'
          + '<span title="' + url + '">' + domain + '</span>'
          + '<button class="site-remove-btn" data-index="' + i + '" style="background:none;border:none;color:#ff4444;cursor:pointer;font-size:16px;line-height:1;" title="Remove">&times;</button>'
          + '</div>';
      }).join('');

      // Re-bind remove buttons
      container.querySelectorAll('.site-remove-btn').forEach(btn => {
        btn.addEventListener('click', () => {
          const idx = parseInt(btn.dataset.index);
          const sites = this.getConfig('sites', []);
          sites.splice(idx, 1);
          this.config.sites = sites;
          this._renderSettingsSites(panel);
        });
      });
    }
  }
}

window.SitesWidget = SitesWidget;
