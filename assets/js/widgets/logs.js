class LogsWidget extends BaseWidget {
  constructor(id, options) {
    super(id, options);
    this.size = options.size || 'large';
    this.apiUrl = options.apiUrl || '/api/logs';
    this._defaultConfig = {
      lines: 40,
      service: 'system',
      autoScroll: true,
      wordWrap: false,
      colspan: 2
    };
    this._configSchema = [
      { key: 'colspan', label: 'Span columns', type: 'number', min: 1, max: 5, step: 1 },
      { key: 'lines', label: 'Lines to show', type: 'number', min: 5, max: 200, step: 5 },
      { key: 'service', label: 'Service', type: 'text' },
      { key: 'autoScroll', label: 'Auto-scroll to bottom', type: 'checkbox' },
      { key: 'wordWrap', label: 'Word wrap', type: 'checkbox' }
    ];
  }

  render() {
    this.element.innerHTML = `
      <div class="widget-header">
        <h3>Logs \\u00B7 ${this.getConfig('service', 'system')}</h3>
        <div class="widget-header-actions">
          ${this.hasSettings() ? '<button class="widget-settings-btn" title="Settings">⚙</button>' : ''}
          <span class="last-update">--:--</span>
        </div>
      </div>
      <div class="widget-body"><pre class="log-viewer" id="log-view"></pre></div>
    `;
    const btn = this.element.querySelector('.widget-settings-btn');
    if (btn) btn.addEventListener('click', () => this.toggleSettings());
  }

  async update() {
    const lines = this.getConfig('lines', 40);
    const service = this.getConfig('service', 'system');
    const autoScroll = this.getConfig('autoScroll', true);
    const wordWrap = this.getConfig('wordWrap', false);
    let d;
    try { d = await (await fetch(`${this.apiUrl}?lines=${lines}&service=${service}`)).json(); }
    catch(e) { d = {lines:['Could not fetch logs']}; }
    const el = this.element.querySelector('#log-view');
    if(el) {
      el.textContent = d.lines.join('\n');
      el.style.whiteSpace = wordWrap ? 'pre-wrap' : 'pre';
      if(autoScroll) el.scrollTop = el.scrollHeight;
    }
    const h3 = this.element.querySelector('.widget-header h3');
    if(h3) h3.textContent = `Logs \u00B7 ${service}`;
    this.element.querySelector('.last-update').textContent = new Date().toLocaleTimeString();
  }
}
window.LogsWidget = LogsWidget;
