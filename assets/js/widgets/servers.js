class ServerWidget extends BaseWidget {
  constructor(id, options) {
    super(id, options);
    this.size = options.size || 'medium';
    this.serverId = options.serverId || null;
    this.apiUrl = options.apiUrl || '/api/server-status';
    this.title = options.title || 'Server Status';
    this._defaultConfig = {
      showCpu: true, showRam: true, showDisk: true, showUptime: true, showLoad: true,
      alertOfflineEnabled: true,
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
      { key: 'alertOfflineEnabled', label: 'Следить за доступностью (online/offline)', type: 'checkbox' },
      { key: 'alertCpuEnabled', label: 'Следить за CPU', type: 'checkbox' },
      { key: 'alertCpuThreshold', label: 'Порог CPU (%)', type: 'range', min: 50, max: 100, step: 1 },
      { key: 'alertRamEnabled', label: 'Следить за RAM', type: 'checkbox' },
      { key: 'alertRamThreshold', label: 'Порог RAM (%)', type: 'range', min: 50, max: 100, step: 1 },
      { key: 'alertDiskEnabled', label: 'Следить за Disk', type: 'checkbox' },
      { key: 'alertDiskThreshold', label: 'Порог Disk (%)', type: 'range', min: 50, max: 100, step: 1 }
    ];
    this._alerted = {};
    this._alertedOffline = false;
  }

  render() {
    this.element.innerHTML = '<div class="widget-header"><h3>' + this.title + '</h3><div class="widget-header-actions"><button class="widget-settings-btn" title="Settings">\u2699</button><span class="last-update">--:--</span></div></div><div class="widget-body" id="servers-' + this.id + '"><div class="server-card"><div class="hostname-line">Loading...</div><div class="server-metrics"><div class="metric metric-cpu"><span class="metric-label cpu-label">CPU</span><div class="progress-bar"><div class="progress-fill" style="width:0%"></div></div><span class="metric-value cpu-value">--%</span></div><div class="metric metric-ram"><span class="metric-label ram-label">RAM</span><div class="progress-bar"><div class="progress-fill" style="width:0%"></div></div><span class="metric-value ram-value">--%</span></div><div class="metric metric-disk"><span class="metric-label disk-label">Disk</span><div class="progress-bar"><div class="progress-fill" style="width:0%"></div></div><span class="metric-value disk-value">--%</span></div><div class="metric inline metric-uptime"><span class="metric-label">Uptime</span><span class="metric-value uptime-value">--</span></div><div class="metric inline metric-load"><span class="metric-label">Load (1/5/15m)</span><span class="metric-value load-value">-- / -- / --</span></div></div></div></div>';
    const btn = this.element.querySelector('.widget-settings-btn');
    if (btn) btn.addEventListener('click', () => this.toggleSettings());
  }

  async update() {
    let data;
    try {
      const res = await fetch(this.apiUrl, { cache: 'no-store' });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      data = await res.json();
    } catch (e) {
      return;
    }

    if (this.serverId) {
      const server = data[this.serverId] || this.getFallback();
      server.id = this.serverId;
      this.updateUI(server);
    }

    this.element.querySelector('.last-update').textContent = new Date().toLocaleTimeString();
  }

  getFallback() {
    return { id: 'unknown', online: false, cpu: 0, ram: 0, disk: 0, uptime: 'OFFLINE', load1: 0, load5: 0, load15: 0, name: 'Unknown', cpu_model: '', cpu_cores: 0, total_ram: '', total_disk: '' };
  }

  updateUI(server) {
    const body = this.element.querySelector('.widget-body');

    // Toggle metric visibility based on config
    const metrics = { cpu: 'metric-cpu', ram: 'metric-ram', disk: 'metric-disk', uptime: 'metric-uptime', load: 'metric-load' };
    for (const [key, cls] of Object.entries(metrics)) {
      const el = body.querySelector('.' + cls);
      if (el) el.style.display = this.getConfig('show' + key.charAt(0).toUpperCase() + key.slice(1), true) ? '' : 'none';
    }

    // Hostname line
    const hostEl = body.querySelector('.hostname-line');
    const statusClass = server.online ? 'status-online' : 'status-offline';
    const statusText = server.online ? 'Online' : 'Offline';
    if (hostEl) hostEl.innerHTML = '<span class="status-indicator ' + statusClass + '"></span> ' + (server.name || server.id) + ' \u2014 ' + statusText;

    // Update labels with absolute values
    const cpuInfo = server.cpu_model || '';
    const cpuCores = server.cpu_cores ? ' (' + server.cpu_cores + 'c)' : '';
    const ramInfo = server.total_ram || '';
    const diskInfo = server.total_disk || '';

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

    const cpuVal = server.online ? (server.cpu || 0) : 0;
    const ramVal = server.online ? (server.ram || 0) : 0;
    const diskVal = server.online ? (server.disk || 0) : 0;

    setBar('cpu-value', cpuVal);
    setBar('ram-value', ramVal);
    setBar('disk-value', diskVal);

    const setVal = (cls, val) => {
      const el = body.querySelector('.' + cls);
      if (el) el.textContent = val;
    };

    setVal('uptime-value', server.online ? (server.uptime || '--') : 'OFFLINE');
    setVal('load-value', (server.load1 != null ? server.load1.toFixed(2) : '--') + ' / ' + (server.load5 != null ? server.load5.toFixed(2) : '--') + ' / ' + (server.load15 != null ? server.load15.toFixed(2) : '--'));

    // --- Alert: offline ---
    if (window.alertManager) {
      const hostname = server.name || server.id;
      if (!server.online && this.getConfig('alertOfflineEnabled', true)) {
        if (!this._alertedOffline) {
          this._alertedOffline = true;
          window.alertManager.trigger({
            widgetId: this.id,
            widgetTitle: this.title + ' (' + hostname + ')',
            metric: 'Доступность',
            value: 0,
            threshold: 0,
            unit: '',
            description: this.title + ' (' + hostname + '): сервер НЕДОСТУПЕН (Offline).\nНет ответа по SSH — проверьте соединение.'
          });
        }
      } else if (server.online) {
        this._alertedOffline = false;
      }

      // Metric alerts (only when online)
      if (server.online) {
        this._checkAlert('CPU', cpuVal, 'alertCpuEnabled', 'alertCpuThreshold', hostname);
        this._checkAlert('RAM', ramVal, 'alertRamEnabled', 'alertRamThreshold', hostname);
        this._checkAlert('Disk', diskVal, 'alertDiskEnabled', 'alertDiskThreshold', hostname);
      }
    }
  }

  _checkAlert(metricName, value, enabledKey, thresholdKey, hostname) {
    const enabled = this.getConfig(enabledKey, false);
    if (!enabled) return;
    const threshold = this.getConfig(thresholdKey, 90);
    if (value > threshold) {
      const key = this.id + '-' + metricName;
      if (this._alerted[key]) return;
      this._alerted[key] = true;
      window.alertManager.trigger({
        widgetId: this.id,
        widgetTitle: this.title + ' (' + hostname + ')',
        metric: metricName,
        value: value,
        threshold: threshold,
        unit: '%',
        description: this.title + ' (' + hostname + '): ' + metricName + ' \u0434\u043E\u0441\u0442\u0438\u0433 ' + value + '% (\u043F\u043E\u0440\u043E\u0433: ' + threshold + '%).\n\u041F\u0440\u0435\u0432\u044B\u0448\u0435\u043D\u0438\u0435 \u043D\u0430 ' + (value - threshold).toFixed(0) + '%.'
      });
    } else {
      const key = this.id + '-' + metricName;
      delete this._alerted[key];
    }
  }
}

window.ServerWidget = ServerWidget;
