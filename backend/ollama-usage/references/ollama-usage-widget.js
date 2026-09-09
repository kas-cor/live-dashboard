class OllamaUsageWidget extends BaseWidget {
  constructor(id, options) {
    super(id, options);
    this.size = options.size || 'medium';
    this.apiUrl = options.apiUrl || '/api/ollama-usage';
    this._defaultConfig = {};
    this._configSchema = [];
  }

  render() {
    this.element.innerHTML = `
      <div class="widget-header">
        <h3>☁️ Ollama Cloud</h3>
        <div class="widget-header-actions">
          <span class="last-update">--:--</span>
        </div>
      </div>
      <div class="widget-body" id="ollama-${this.id}">
        <div class="ollama-card">
          <div class="ollama-plan-line">Loading...</div>
          <div class="ollama-metrics">
            <div class="ollama-metric-block">
              <div class="ollama-metric-header">
                <span class="ollama-metric-title">Included usage</span>
                <span class="ollama-metric-reset usage-reset">resets: --</span>
              </div>
              <div class="metric">
                <div class="progress-bar"><div class="progress-fill" style="width:0%"></div></div>
                <span class="metric-value usage-value">--%</span>
              </div>
            </div>
          </div>
          <div class="ollama-models">
            <div class="models-header">Models this month</div>
            <div class="models-list"></div>
          </div>
        </div>
      </div>
    `;
  }

  async update() {
    let d;
    try { d = await (await fetch(this.apiUrl)).json(); }
    catch(e) { return; }

    if (d.error === 'no_data') {
      const body = this.element.querySelector('.widget-body');
      if (body) body.innerHTML = '<div class="ollama-card"><div class="ollama-plan-line">No data yet — waiting for first fetch...</div></div>';
      return;
    }

    const body = this.element.querySelector('.widget-body');
    if (!body) return;

    // Plan line — единый месячный пул Included usage
    const planEl = body.querySelector('.ollama-plan-line');
    const plan = d.plan || 'unknown';
    if (planEl) {
      const planName = plan.charAt(0).toUpperCase() + plan.slice(1);
      planEl.innerHTML = `<span class="status-indicator status-online"></span> ${planName} · included usage`;
    }

    const usage = d.usage || {};
    const usagePct = usage.percent || 0;

    // Helper: format reset as relative time
    const fmtReset = (iso) => {
      if (!iso) return '--';
      const dt = new Date(iso);
      const now = new Date();
      const diff = dt - now;
      if (isNaN(diff) || diff <= 0) return 'now';
      const days = Math.floor(diff / 86400000);
      const hours = Math.floor((diff % 86400000) / 3600000);
      const mins = Math.floor((diff % 3600000) / 60000);
      if (days > 0) return `${days}d ${hours}h`;
      if (hours > 0) return `${hours}h ${mins}m`;
      return `${mins}m`;
    };

    // Update usage bar
    const valEl = body.querySelector('.usage-value');
    const bar = valEl?.closest('.metric')?.querySelector('.progress-fill');
    if (bar) {
      bar.style.width = Math.min(usagePct, 100) + '%';
      if (usagePct > 80) bar.style.background = '#ff5500';
      else if (usagePct > 50) bar.style.background = '#ffcc00';
      else bar.style.background = '#00ff88';
    }
    if (valEl) valEl.textContent = usagePct + '%';

    // Reset time in header
    const resetEl = body.querySelector('.usage-reset');
    if (resetEl) resetEl.textContent = 'resets: ' + fmtReset(usage.resets_at);

    // Models this month (по доле usage)
    const modelsList = body.querySelector('.models-list');
    if (modelsList && usage.models) {
      const sorted = [...usage.models].sort((a, b) => b.percent - a.percent).slice(0, 5);
      const maxPct = sorted.length ? Math.max(...sorted.map(m => m.percent || 0)) : 0;
      modelsList.innerHTML = sorted.map(m => {
        const pct = m.percent || 0;
        const barW = maxPct > 0 ? Math.max(pct / maxPct * 90, 2) : 2;
        const reqLabel = m.requests === 1 ? 'request' : 'requests';
        return `<div class="model-row">
          <span class="model-name" title="${m.model}">${m.model}</span>
          <div class="model-bar-track"><div class="model-bar-fill" style="width:${barW}%"></div></div>
          <span class="model-reqs">${m.requests}</span>
        </div>`;
      }).join('');
    }

    this.element.querySelector('.last-update').textContent = new Date().toLocaleTimeString();
  }
}

window.OllamaUsageWidget = OllamaUsageWidget;
