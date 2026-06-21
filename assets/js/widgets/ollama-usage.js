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
                <span class="ollama-metric-title">Session</span>
                <span class="ollama-metric-reset reset-session">resets: --</span>
              </div>
              <div class="metric">
                <div class="progress-bar"><div class="progress-fill" style="width:0%"></div></div>
                <span class="metric-value session-value">--%</span>
              </div>
            </div>
            <div class="ollama-metric-block">
              <div class="ollama-metric-header">
                <span class="ollama-metric-title">Weekly</span>
                <span class="ollama-metric-reset reset-weekly">resets: --</span>
              </div>
              <div class="metric">
                <div class="progress-bar"><div class="progress-fill" style="width:0%"></div></div>
                <span class="metric-value weekly-value">--%</span>
              </div>
            </div>
          </div>
          <div class="ollama-models">
            <div class="models-header">Top Models Weekly</div>
            <div class="models-list"></div>
            <div class="ollama-subscription"></div>
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

    // Plan line
    const planEl = body.querySelector('.ollama-plan-line');
    const plan = d.plan || 'unknown';
    if (planEl) planEl.innerHTML = `<span class="status-indicator ${plan === 'pro' ? 'status-online' : 'status-warning'}"></span> ${plan.charAt(0).toUpperCase() + plan.slice(1)} plan`;

    // Session & Weekly percents
    const sessionPct = d.session?.percent || 0;
    const weeklyPct = d.weekly?.percent || 0;

    // Helper: format reset as relative time
    const fmtReset = (iso) => {
      if (!iso) return '--';
      const dt = new Date(iso);
      const now = new Date();
      const diff = dt - now;
      if (isNaN(diff) || diff <= 0) return 'now';
      const hours = Math.floor(diff / 3600000);
      const mins = Math.floor((diff % 3600000) / 60000);
      if (hours > 0) return `${hours}h ${mins}m`;
      return `${mins}m`;
    };

    // Update bars
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

    setBar('session-value', sessionPct);
    setBar('weekly-value', weeklyPct);

    // Reset times in headers
    const resetS = body.querySelector('.reset-session');
    const resetW = body.querySelector('.reset-weekly');
    if (resetS) resetS.textContent = 'resets: ' + fmtReset(d.session?.resets_at);
    if (resetW) resetW.textContent = 'resets: ' + fmtReset(d.weekly?.resets_at);

    // Top models (weekly)
    const modelsList = body.querySelector('.models-list');
    if (modelsList && d.weekly?.models) {
      const sorted = [...d.weekly.models].sort((a, b) => b.requests - a.requests).slice(0, 5);
      const total = sorted.reduce((s, m) => s + m.requests, 0);
      modelsList.innerHTML = sorted.map(m => {
        const pct = total > 0 ? (m.requests / total * 100).toFixed(1) : 0;
        const barW = Math.max(pct * 0.8, 2);
        return `<div class="model-row">
          <span class="model-name" title="${m.model}">${m.model}</span>
          <div class="model-bar-track"><div class="model-bar-fill" style="width:${barW}%"></div></div>
          <span class="model-reqs">${m.requests}</span>
        </div>`;
      }).join('');
    }

    // Subscription countdown (only for non-free plans)
    const subEl = body.querySelector('.ollama-subscription');
    if (subEl) {
      if (plan !== 'free' && d.subscription && d.subscription.ends_at_formatted && d.subscription.ends_at) {
        const now = new Date();
        const end = new Date(d.subscription.ends_at + 'T23:59:59Z');
        const diff = end - now;
        if (diff > 0) {
          const days = Math.floor(diff / 86400000);
          const hours = Math.floor((diff % 86400000) / 3600000);
          const mins = Math.floor((diff % 3600000) / 60000);
          let countdown = '';
          if (days > 0) {
            countdown = ` (${days}d ${hours}h ${mins}m)`;
          } else {
            countdown = ` (${hours}h ${mins}m)`;
          }
          subEl.textContent = 'Subscription ends: ' + d.subscription.ends_at_formatted + countdown;
        } else {
          subEl.textContent = '';
        }
      } else {
        subEl.textContent = '';
      }
    }

    this.element.querySelector('.last-update').textContent = new Date().toLocaleTimeString();
  }
}

window.OllamaUsageWidget = OllamaUsageWidget;
