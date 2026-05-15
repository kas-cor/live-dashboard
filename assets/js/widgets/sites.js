class SitesWidget extends BaseWidget {
  constructor(id, options) {
    super(id, options);
    this.size = options.size || 'medium';
    this.apiUrl = options.apiUrl || '/api/site-status';
    this._defaultConfig = {
      title: 'Site Status',
      highlightOffline: true,
      showStatusCode: true,
      alertOfflineEnabled: true
    };
    this._configSchema = [
      { key: 'title', label: 'Widget title', type: 'text' },
      { key: 'highlightOffline', label: 'Highlight offline sites', type: 'checkbox' },
      { key: 'showStatusCode', label: 'Show error status codes', type: 'checkbox' },
      { key: '_alertSection', label: '\u041C\u043E\u043D\u0438\u0442\u043E\u0440\u0438\u043D\u0433 \u043A\u0440\u0438\u0442\u0438\u0447\u0435\u0441\u043A\u0438\u0445 \u0441\u043E\u0441\u0442\u043E\u044F\u043D\u0438\u0439', type: 'section' },
      { key: 'alertOfflineEnabled', label: '\u0421\u043B\u0435\u0434\u0438\u0442\u044C \u0437\u0430 offline \u0441\u0430\u0439\u0442\u0430\u043C\u0438', type: 'checkbox' }
    ];
    this._alertedOffline = null;
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
    let data;
    try {
      const res = await fetch(this.apiUrl, { cache: 'no-store' });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      data = await res.json();
    } catch (e) { return; }
    const list = this.element.querySelector('.site-list');
    if (!list) return;
    list.innerHTML = data.map(s => this.buildSiteRow(s, true)).join('');

    // --- Alert: offline sites ---
    if (window.alertManager && this.getConfig('alertOfflineEnabled', false)) {
      const offline = data.filter(s => !s.online);
      if (offline.length > 0) {
        const key = offline.map(s => new URL(s.url).hostname).sort().join(',');
        if (this._alertedOffline !== key) {
          this._alertedOffline = key;
          const names = offline.map(s => {
            const domain = new URL(s.url).hostname;
            return domain + ' (' + s.status + ')';
          }).join(', ');
          window.alertManager.trigger({
            widgetId: this.id,
            widgetTitle: 'Sites',
            metric: 'Offline',
            value: offline.length,
            threshold: 0,
            unit: ' \u0441\u0430\u0439\u0442.',
            description: '\u041E\u0431\u043D\u0430\u0440\u0443\u0436\u0435\u043D\u044B \u043D\u0435\u0434\u043E\u0441\u0442\u0443\u043F\u043D\u044B\u0435 \u0441\u0430\u0439\u0442\u044B (' + offline.length + '):\n' + names
          });
        }
      } else {
        this._alertedOffline = null;
      }
    }
  }
}

window.SitesWidget = SitesWidget;
