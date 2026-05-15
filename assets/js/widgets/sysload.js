class SysLoadWidget extends BaseWidget {
  constructor(id, options) {
    super(id, options);
    this.size = options.size || 'medium';
    this.apiUrl = options.apiUrl || '/api/sysinfo';
    this._defaultConfig = {
      showCpu: true, showRam: true, showDisk: true, showUptime: true, showLoad: true,
      alertCpuEnabled: true, alertCpuThreshold: 90,
      alertRamEnabled: true, alertRamThreshold: 90,
      alertDiskEnabled: true, alertDiskThreshold: 90
    };
    this._configSchema = [
      { key: 'showCpu', label: 'Показывать CPU', type: 'checkbox' },
      { key: 'showRam', label: 'Показывать RAM', type: 'checkbox' },
      { key: 'showDisk', label: 'Показывать Disk', type: 'checkbox' },
      { key: 'showUptime', label: 'Показывать Uptime', type: 'checkbox' },
      { key: 'showLoad', label: 'Показывать Load', type: 'checkbox' },
      { key: '_alertSection', label: 'Мониторинг критических состояний', type: 'section' },
      { key: 'alertCpuEnabled', label: 'Следить за CPU', type: 'checkbox' },
      { key: 'alertCpuThreshold', label: 'Порог CPU (%)', type: 'range', min: 50, max: 100, step: 1 },
      { key: 'alertRamEnabled', label: 'Следить за RAM', type: 'checkbox' },
      { key: 'alertRamThreshold', label: 'Порог RAM (%)', type: 'range', min: 50, max: 100, step: 1 },
      { key: 'alertDiskEnabled', label: 'Следить за Disk', type: 'checkbox' },
      { key: 'alertDiskThreshold', label: 'Порог Disk (%)', type: 'range', min: 50, max: 100, step: 1 }
    ];
    this._alerted = {}; // track already-alerted metrics to avoid spam per session
  }

  render() {
    this.element.innerHTML = '<div class="widget-header"><h3>System Load</h3><div class="widget-header-actions"><button class="widget-settings-btn" title="Settings">\u2699</button><span class="last-update">--:--</span></div></div><div class="widget-body" id="sysload-' + this.id + '"><div class="server-card"><div class="hostname-line">Loading...</div><div class="server-metrics"><div class="metric metric-cpu"><span class="metric-label cpu-label">CPU</span><div class="progress-bar"><div class="progress-fill" style="width:0%"></div></div><span class="metric-value cpu-value">--%</span></div><div class="metric metric-ram"><span class="metric-label ram-label">RAM</span><div class="progress-bar"><div class="progress-fill" style="width:0%"></div></div><span class="metric-value ram-value">--%</span></div><div class="metric metric-disk"><span class="metric-label disk-label">Disk</span><div class="progress-bar"><div class="progress-fill" style="width:0%"></div></div><span class="metric-value disk-value">--%</span></div><div class="metric inline metric-uptime"><span class="metric-label">Uptime</span><span class="metric-value uptime-value">--</span></div><div class="metric inline metric-load"><span class="metric-label">Load (1/5/15m)</span><span class="metric-value load-value">-- / -- / --</span></div></div></div></div>';
    const btn = this.element.querySelector('.widget-settings-btn');
    if (btn) btn.addEventListener('click', () => this.toggleSettings());
  }

  async update() {
    let d;
    try { d = await (await fetch(this.apiUrl)).json(); }
    catch(e) { return; }

    const body = this.element.querySelector('.widget-body');

    // Toggle metric visibility
    const metrics = { cpu: 'metric-cpu', ram: 'metric-ram', disk: 'metric-disk', uptime: 'metric-uptime', load: 'metric-load' };
    for (const [key, cls] of Object.entries(metrics)) {
      const el = body.querySelector('.' + cls);
      if (el) el.style.display = this.getConfig('show' + key.charAt(0).toUpperCase() + key.slice(1), true) ? '' : 'none';
    }

    // Hostname line
    const hostEl = body.querySelector('.hostname-line');
    const hostname = d.hostname || '--';
    if (hostEl) hostEl.innerHTML = '<span class="status-indicator status-online"></span> ' + hostname + ' \u2014 Online';

    // Update labels with absolute values
    const cpuInfo = d.cpu_model || '';
    const cpuCores = d.cpu_cores ? ' (' + d.cpu_cores + 'c)' : '';
    const ramInfo = d.total_ram || '';
    const diskInfo = d.total_disk || '';

    const cpuLabel = body.querySelector('.cpu-label');
    const ramLabel = body.querySelector('.ram-label');
    const diskLabel = body.querySelector('.disk-label');

    if (cpuLabel) cpuLabel.textContent = 'CPU' + (cpuInfo ? ' \u2014 ' + cpuInfo + cpuCores : '');
    if (ramLabel) ramLabel.textContent = 'RAM' + (ramInfo ? ' \u2014 ' + ramInfo : '');
    if (diskLabel) diskLabel.textContent = 'Disk' + (diskInfo ? ' \u2014 ' + diskInfo : '');

    // Bars
    const setBar = (cls, val) => {
      const el = body.querySelector('.' + cls);
      if (!el) return;
      const bar = el.closest('.metric')?.querySelector('.progress-fill');
      const num = typeof val === 'number' ? val : 0;
      if (bar) {
        bar.style.width = Math.min(num, 100) + '%';
        if (num > 80) bar.style.background = '#ff5500';
        else if (num > 50) bar.style.background = '#ffcc00';
        else bar.style.background = '#00ff88';
      }
      el.textContent = num + '%';
    };

    const cpuVal = d.cpu || 0;
    const ramVal = d.ram || 0;
    const diskVal = d.disk || 0;

    setBar('cpu-value', cpuVal);
    setBar('ram-value', ramVal);
    setBar('disk-value', diskVal);

    const setVal = (cls, val) => {
      const el = body.querySelector('.' + cls);
      if (el) el.textContent = val;
    };

    setVal('uptime-value', d.uptime || '--');
    setVal('load-value', (d.load1 != null ? d.load1.toFixed(2) : '--') + ' / ' + (d.load5 != null ? d.load5.toFixed(2) : '--') + ' / ' + (d.load15 != null ? d.load15.toFixed(2) : '--'));

    this.element.querySelector('.last-update').textContent = new Date().toLocaleTimeString();

    // --- Alert checks ---
    if (!window.alertManager) return;
    this._checkAlert('CPU', cpuVal, 'alertCpuEnabled', 'alertCpuThreshold', hostname);
    this._checkAlert('RAM', ramVal, 'alertRamEnabled', 'alertRamThreshold', hostname);
    this._checkAlert('Disk', diskVal, 'alertDiskEnabled', 'alertDiskThreshold', hostname);
  }

  _checkAlert(metricName, value, enabledKey, thresholdKey, hostname) {
    const enabled = this.getConfig(enabledKey, false);
    if (!enabled) return;
    const threshold = this.getConfig(thresholdKey, 90);
    if (value > threshold) {
      // Only fire once per session per metric
      const key = this.id + '-' + metricName;
      if (this._alerted[key]) return;
      this._alerted[key] = true;
      window.alertManager.trigger({
        widgetId: this.id,
        widgetTitle: 'System Load (' + hostname + ')',
        metric: metricName,
        value: value,
        threshold: threshold,
        unit: '%',
        description: 'System Load (' + hostname + '): ' + metricName + ' \u0434\u043E\u0441\u0442\u0438\u0433 ' + value + '% (\u043F\u043E\u0440\u043E\u0433: ' + threshold + '%).\n\u041F\u0440\u0435\u0432\u044B\u0448\u0435\u043D\u0438\u0435 \u043D\u0430 ' + (value - threshold).toFixed(0) + '%.'
      });
    } else {
      // Reset alert flag when value drops below threshold
      const key = this.id + '-' + metricName;
      delete this._alerted[key];
    }
  }
}

window.SysLoadWidget = SysLoadWidget;
