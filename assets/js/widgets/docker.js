class DockerWidget extends BaseWidget {
  constructor(id, options) {
    super(id, options);
    this.size = options.size || 'large';
    this.apiUrl = options.apiUrl || '/api/docker';
    this._defaultConfig = {
      showStopped: true,
      showPorts: true,
      filterRunning: false,
      alertStoppedEnabled: true,
      alertStoppedThreshold: 0
    };
    this._configSchema = [
      { key: 'showStopped', label: 'Show stopped containers', type: 'checkbox' },
      { key: 'showPorts', label: 'Show port mappings', type: 'checkbox' },
      { key: 'filterRunning', label: 'Show only running', type: 'checkbox' },
      { key: '_alertSection', label: '\u041C\u043E\u043D\u0438\u0442\u043E\u0440\u0438\u043D\u0433 \u043A\u0440\u0438\u0442\u0438\u0447\u0435\u0441\u043A\u0438\u0445 \u0441\u043E\u0441\u0442\u043E\u044F\u043D\u0438\u0439', type: 'section' },
      { key: 'alertStoppedEnabled', label: '\u0421\u043B\u0435\u0434\u0438\u0442\u044C \u0437\u0430 \u043E\u0441\u0442\u0430\u043D\u043E\u0432\u043B\u0435\u043D\u043D\u044B\u043C\u0438 \u043A\u043E\u043D\u0442\u0435\u0439\u043D\u0435\u0440\u0430\u043C\u0438', type: 'checkbox' },
      { key: 'alertStoppedThreshold', label: '\u041C\u0430\u043A\u0441. \u043E\u0441\u0442\u0430\u043D\u043E\u0432\u043B\u0435\u043D\u043D\u044B\u0445 \u0434\u043E \u0442\u0440\u0435\u0432\u043E\u0433\u0438', type: 'number', min: 0, max: 20, step: 1 }
    ];
    this._alertedStopped = null; // track which stopped containers we alerted for
  }

  render() {
    this.element.innerHTML = '<div class="widget-header"><h3>Docker Containers</h3><div class="widget-header-actions">' + (this.hasSettings() ? '<button class="widget-settings-btn" title="Settings">\u2699</button>' : '') + '</div></div><div class="widget-body" id="docker-grid"><div class="empty-state">Loading...</div></div>';
    this.element.classList.add('widget-scroll');
    const btn = this.element.querySelector('.widget-settings-btn');
    if (btn) btn.addEventListener('click', () => this.toggleSettings());
  }

  async update() {
    const showStopped = this.getConfig('showStopped', true);
    const showPorts = this.getConfig('showPorts', true);
    const filterRunning = this.getConfig('filterRunning', false);
    let data;
    try { data = await (await fetch(this.apiUrl)).json(); }
    catch(e) { data = []; }
    const grid = this.element.querySelector('#docker-grid');
    if(!data.length) { grid.innerHTML = '<div class="empty-state">No containers</div>'; return; }
    let filtered = data;
    if (filterRunning) filtered = data.filter(c => c.running);
    else if (!showStopped) filtered = data.filter(c => c.running);
    grid.innerHTML = filtered.map(c => '<div class="docker-card ' + (c.running?'running':'stopped') + '"><div class="docker-header"><span class="docker-status ' + (c.running?'status-online':'status-offline') + '"></span><span class="docker-name">' + c.name + '</span></div><div class="docker-meta">' + c.image + '</div><div class="docker-meta">' + c.status + '</div>' + (showPorts && c.ports?'<div class="docker-ports">' + c.ports + '</div>':'') + '</div>').join('');

    // --- Alert: stopped containers ---
    if (window.alertManager && this.getConfig('alertStoppedEnabled', false)) {
      const stopped = data.filter(c => !c.running);
      const threshold = this.getConfig('alertStoppedThreshold', 0);
      if (stopped.length > threshold) {
        const stoppedNames = stopped.map(c => c.name).join(', ');
        const key = stoppedNames; // fingerprint to avoid re-alerting same set
        if (this._alertedStopped !== key) {
          this._alertedStopped = key;
          window.alertManager.trigger({
            widgetId: this.id,
            widgetTitle: 'Docker Containers',
            metric: 'Stopped',
            value: stopped.length,
            threshold: threshold,
            unit: ' \u0448\u0442.',
            description: 'Docker: ' + stopped.length + ' \u043E\u0441\u0442\u0430\u043D\u043E\u0432\u043B\u0435\u043D\u043D\u044B\u0445 \u043A\u043E\u043D\u0442\u0435\u0439\u043D\u0435\u0440\u043E\u0432 (\u043F\u043E\u0440\u043E\u0433: ' + threshold + ').\n' + stoppedNames
          });
        }
      } else {
        this._alertedStopped = null;
      }
    }
  }
}
window.DockerWidget = DockerWidget;
