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
      const metricEl = el.closest('.metric');
      const bar = metricEl?.querySelector('.progress-fill');
      const num = typeof val === 'number' ? val : 0;
      if (bar) {
        bar.style.width = Math.min(num, 100) + '%';
        if (num > 80) bar.style.background = '#ff5500';
        else if (num > 50) bar.style.background = '#ffcc00';
        else bar.style.background = '#00ff88';
      }
      el.textContent = num + '%';

      // Threshold line
      const metricName = cls.replace('-value', '');
      const thresholdKey = 'alert' + metricName.charAt(0).toUpperCase() + metricName.slice(1) + 'Threshold';
      const threshold = this.getConfig(thresholdKey, 90);
      let line = metricEl?.querySelector('.threshold-line');
      if (!line && metricEl) {
        line = document.createElement('div');
        line.className = 'threshold-line';
        line.style.cssText = 'position:absolute;top:0;bottom:0;width:2px;background:#ff0044;opacity:0.7;z-index:2;';
        const barContainer = metricEl.querySelector('.progress-bar');
        if (barContainer) {
          barContainer.style.position = 'relative';
          barContainer.appendChild(line);
        }
      }
      if (line) {
        line.style.left = Math.min(threshold, 100) + '%';
        line.title = 'Порог: ' + threshold + '%';
      }
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

    // --- Server-side alerts: backend checks thresholds, we only display ---
    if (window.alertManager && d.alerts && d.alerts.length > 0) {
      for (const alert of d.alerts) {
        window.alertManager.trigger(alert);
        // If alert has description — it already fired, remove pending indicator
        if (alert.description) {
          const metricEl = body.querySelector('.metric-' + (alert.metric || '').toLowerCase());
          if (metricEl) {
            const pendingEl = metricEl.querySelector('.alert-pending');
            if (pendingEl) pendingEl.remove();
          }
        } else if (alert.consecutive_hits && alert.consecutive_threshold) {
          // Show pending accumulation in the metric bar
          const metricEl = body.querySelector('.metric-' + (alert.metric || '').toLowerCase());
          if (metricEl) {
            let pendingEl = metricEl.querySelector('.alert-pending');
            if (!pendingEl) {
              pendingEl = document.createElement('span');
              pendingEl.className = 'alert-pending';
              pendingEl.style.cssText = 'display:block;font-size:10px;color:#ff8800;margin-top:2px;';
              metricEl.appendChild(pendingEl);
            }
            pendingEl.textContent = '⚠ ' + alert.consecutive_hits + '/' + alert.consecutive_threshold;
          }
        }
      }
    } else if (d.alerts && d.alerts.length === 0) {
      // Clear all pending indicators when condition resolved
      body.querySelectorAll('.alert-pending').forEach(el => el.remove());
    }
  }
}

window.SysLoadWidget = SysLoadWidget;
