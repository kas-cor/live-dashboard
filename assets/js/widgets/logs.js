class LogsWidget extends BaseWidget {
  constructor(id, options) {
    super(id, options);
    this.size = options.size || 'large';
    this.apiUrl = options.apiUrl || '/api/logs';
    this._defaultConfig = {
      lines: 40,
      services: 'system',
      autoScroll: true,
      wordWrap: false,
      colspan: 2
    };
    this._configSchema = [
      { key: 'colspan', label: 'Span columns', type: 'number', min: 1, max: 5, step: 1 },
      { key: 'lines', label: 'Lines per service', type: 'number', min: 5, max: 200, step: 5 },
      { key: 'services', label: 'Services (comma-separated)', type: 'text' },
      { key: 'autoScroll', label: 'Auto-scroll to bottom', type: 'checkbox' },
      { key: 'wordWrap', label: 'Word wrap', type: 'checkbox' }
    ];
    this._servicesCache = {}; // {serviceName: {scrollTop, ...}}
    this._focused = false; // pause updates while textarea focused
  }

  render() {
    this.element.innerHTML = `
      <div class="widget-header">
        <h3>Logs <span class="log-pause-badge" id="pause-badge-${this.id}" style="display:none">⏸ Paused</span></h3>
        <div class="widget-header-actions">
          ${this.hasSettings() ? '<button class="widget-settings-btn" title="Settings">\u2699</button>' : ''}
          <span class="last-update">--:--</span>
        </div>
      </div>
      <div class="widget-body" id="log-sections-${this.id}"></div>
    `;
    const btn = this.element.querySelector('.widget-settings-btn');
    if (btn) btn.addEventListener('click', () => this.toggleSettings());
    // Focus tracking: pause updates while copying text (delegation — one listener)
    const container = this.element.querySelector('#log-sections-' + this.id);
    if (container) {
      container.addEventListener('focusin', (e) => {
        if (e.target.matches('.log-textarea')) {
          this._focused = true;
          const badge = document.getElementById('pause-badge-' + this.id);
          if (badge) badge.style.display = '';
        }
      });
      container.addEventListener('focusout', (e) => {
        if (e.target.matches('.log-textarea')) {
          this._focused = false;
          const badge = document.getElementById('pause-badge-' + this.id);
          if (badge) badge.style.display = 'none';
        }
      });
    }
  }

  async update() {
    // Pause while user is interacting with a textarea (selecting/copying)
    if (this._focused) return;

    const lines = this.getConfig('lines', 40);
    const servicesRaw = this.getConfig('services', 'system');
    const svcs = servicesRaw.split(',').map(s => s.trim()).filter(Boolean);
    if (svcs.length === 0) return;

    const autoScroll = this.getConfig('autoScroll', true);
    const wordWrap = this.getConfig('wordWrap', false);

    let data;
    try {
      const resp = await fetch(`${this.apiUrl}?lines=${lines}&services=${encodeURIComponent(svcs.join(','))}`);
      data = await resp.json();
    } catch (e) {
      data = { entries: {} };
      for (const svc of svcs) data.entries[svc] = ['⚠ Could not fetch logs'];
    }

    const container = this.element.querySelector('#log-sections-' + this.id);
    if (!container) return;

    const entries = data.entries || {};

    // Build HTML for all services
    let html = '';
    for (const svc of svcs) {
      const svcLines = entries[svc] || ['⚠ No data'];
      // Escape HTML for safe display in textarea
      const escaped = svcLines
        .map(l => l.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'))
        .join('\n');
      html += `
        <div class="log-section">
          <div class="log-section-header">
            <span class="log-section-title">${svc}</span>
            <span class="log-section-count">${svcLines.length} lines</span>
          </div>
          <textarea class="log-textarea" data-service="${svc}" readonly spellcheck="false" wrap="${wordWrap ? 'on' : 'off'}">${escaped}</textarea>
        </div>
      `;
    }
    container.innerHTML = html;

    // Restore scroll positions and auto-scroll
    for (const svc of svcs) {
      const textarea = container.querySelector(`textarea[data-service="${svc}"]`);
      if (!textarea) continue;
      if (autoScroll) {
        textarea.scrollTop = textarea.scrollHeight;
      } else if (this._servicesCache[svc]) {
        textarea.scrollTop = this._servicesCache[svc].scrollTop || 0;
      }
      // Save scroll position on scroll
      textarea.addEventListener('scroll', () => {
        if (!this._servicesCache[svc]) this._servicesCache[svc] = {};
        this._servicesCache[svc].scrollTop = textarea.scrollTop;
      });
      // Sync word-wrap
      if (wordWrap) textarea.style.whiteSpace = 'pre-wrap';
      else textarea.style.whiteSpace = 'pre';
    }

    const el = this.element.querySelector('.last-update');
    if (el) el.textContent = new Date().toLocaleTimeString();
  }
}
window.LogsWidget = LogsWidget;
