class ClockWidget extends BaseWidget {
  constructor(id, options) {
    super(id, options);
    this.size = 'small';
    this._defaultConfig = { format: '24h', showDate: true };
    this._configSchema = [
      { key: 'format', label: 'Time format', type: 'select', options: [{ value: '24h', label: '24-hour' }, { value: '12h', label: '12-hour' }] },
      { key: 'showDate', label: 'Show date', type: 'checkbox' }
    ];
  }

  render() {
    this.element.innerHTML = `
      <div class="widget-header">
        <h3>Clock</h3>
        <div class="widget-header-actions">
          ${this.hasSettings() ? '<button class="widget-settings-btn" title="Settings">⚙</button>' : ''}
        </div>
      </div>
      <div class="widget-body clock-body">
        <div class="clock-time">00:00:00</div>
        <div class="clock-date">-- -- ----</div>
      </div>
    `;
    const btn = this.element.querySelector('.widget-settings-btn');
    if (btn) btn.addEventListener('click', () => this.toggleSettings());
  }

  update() {
    const now = new Date();
    const timeEl = this.element.querySelector('.clock-time');
    const dateEl = this.element.querySelector('.clock-date');
    const fmt = this.getConfig('format', '24h');
    if (timeEl) timeEl.textContent = now.toLocaleTimeString('ru-RU', { hour12: fmt === '12h' });
    if (dateEl) dateEl.style.display = this.getConfig('showDate', true) ? '' : 'none';
    if (dateEl && this.getConfig('showDate', true)) {
      dateEl.textContent = now.toLocaleDateString('ru-RU', { weekday: 'long', day: 'numeric', month: 'long' });
    }
  }
}

window.ClockWidget = ClockWidget;