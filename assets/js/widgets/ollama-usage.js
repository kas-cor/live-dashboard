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
                <span class="metric-amount usage-amount"></span>
              </div>
            </div>
          </div>
          <div class="ollama-models">
            <div class="models-header">Models this month</div>
            <div class="models-list"></div>
          </div>
          <div class="ollama-depletion"></div>
        </div>
      </div>
    `;
  }

  async update() {
    let d;
    try { d = await (await fetch(this.apiUrl)).json(); }
    catch(e) { return; }

    if (d?.error === 'no_data' || d?.error) {
      const body = this.element.querySelector('.widget-body');
      if (body) body.innerHTML = '<div class="ollama-card"><div class="ollama-plan-line">No current usage data available.</div></div>';
      return;
    }

    const body = this.element.querySelector('.widget-body');
    if (!body) return;

    if (d.report) {
      const report = d.report;
      const escape = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
      })[char]);
      const money = (value) => {
        const amount = Number(value);
        return value == null || !Number.isFinite(amount) ? '—' : `$${amount.toFixed(2)}`;
      };
      const models = Array.isArray(report.models) ? report.models : [];
      // Provider-controlled strings are HTML-escaped before this template is inserted.
      body.innerHTML = `<div class="ollama-card ollama-report">
        <div class="ollama-report-summary">
          <div><span class="ollama-report-label">Total cost</span><strong>${money(report.total_cost)}</strong></div>
          <div><span class="ollama-report-label">Requests</span><strong>${escape(report.requests ?? '—')}</strong></div>
        </div>
        <div class="ollama-report-period">${escape(report.period || 'Current period')} · Model cost ${money(report.model_cost)}</div>
        <div class="ollama-report-note">Usage quota and percentage are not provided in the current Ollama report.</div>
        ${models.length ? `<div class="ollama-models"><div class="models-header">Models (${models.length})</div><div class="models-list ollama-report-model-list">${models.map((model) => `<div class="model-row">
          <span class="model-name">${escape(model.name)}</span><span class="model-reqs">${escape(model.requests)} requests</span>
          <span class="model-cost">${money(model.cost)}</span></div>`).join('')}</div></div>` : ''}
      </div>`;
      const stamp = this.element.querySelector('.last-update');
      if (stamp && d.fetched_at) stamp.textContent = new Date(d.fetched_at).toLocaleTimeString('en-GB', { hour12: false });
      return;
    }

    const usage = d.usage || {};
    const plan = d.plan || 'unknown';
    if (plan === 'unknown' || typeof usage.percent !== 'number' || !Number.isFinite(usage.percent)) {
      // Fixed explanatory text; do not invent 0% when quota data is absent.
      body.innerHTML = '<div class="ollama-card"><div class="ollama-plan-line">No current included-usage data available.</div></div>';
      return;
    }

    // Plan line — единый месячный пул Included usage
    const planEl = body.querySelector('.ollama-plan-line');
    if (planEl) {
      const planName = plan.charAt(0).toUpperCase() + plan.slice(1);
      planEl.innerHTML = `<span class="status-indicator status-online"></span> ${planName} · included usage`;
    }

    const usagePct = usage.percent;

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

    // Absolute reset datetime (local): m.d.Y H:i
    const fmtAbsReset = (iso) => {
      if (!iso) return null;
      const dt = new Date(iso);
      if (isNaN(dt)) return null;
      const p = (n) => String(n).padStart(2, '0');
      return `${p(dt.getDate())}.${p(dt.getMonth() + 1)}.${dt.getFullYear()} ${p(dt.getHours())}:${p(dt.getMinutes())}`;
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

    // Absolute spend (pro/max plans expose "$X of $Y" instead of a percent)
    const amountEl = body.querySelector('.usage-amount');
    if (amountEl) {
      if (usage.used != null && usage.limit != null) {
        const cur = usage.currency || '';
        const fmt = (n) => Number.isInteger(n) ? n : n.toFixed(2);
        amountEl.textContent = `${cur}${fmt(usage.used)} / ${cur}${fmt(usage.limit)}`;
      } else {
        amountEl.textContent = '';
      }
    }

    // Reset time in header: absolute (local) + relative in parens
    const resetEl = body.querySelector('.usage-reset');
    if (resetEl) {
      const abs = fmtAbsReset(usage.resets_at);
      if (abs) resetEl.textContent = `resets: ${abs} (${fmtReset(usage.resets_at)})`;
      else resetEl.textContent = 'resets: --';
    }

    // Models this month (по доле usage)
    const modelsList = body.querySelector('.models-list');
    if (modelsList && usage.models) {
      const sorted = [...usage.models].sort((a, b) => b.percent - a.percent);
      const modelsHeader = body.querySelector('.models-header');
      if (modelsHeader) modelsHeader.textContent = `Models this month (${sorted.length})`;
      const maxPct = sorted.length ? Math.max(...sorted.map(m => m.percent || 0)) : 0;
      modelsList.innerHTML = sorted.map(m => {
        const pct = m.percent || 0;
        const barW = maxPct > 0 ? Math.max(pct / maxPct * 90, 2) : 2;
        // Absolute spend per model (site gives the share, forecast adds $)
        const cost = m.cost_usd != null ? `$${m.cost_usd.toFixed(2)}` : '';
        return `<div class="model-row">
          <span class="model-name" title="${m.model}">${m.model}</span>
          <div class="model-bar-track"><div class="model-bar-fill" style="width:${barW}%"></div></div>
          <span class="model-cost">${cost}</span>
          <span class="model-reqs">${m.requests}</span>
        </div>`;
      }).join('');
    }

    // Projected depletion — avg burn rate over the elapsed part of the period
    const depleteEl = body.querySelector('.ollama-depletion');
    if (depleteEl) {
      const fc = usage.forecast || {};
      const lines = [];
      const abs = fmtAbsReset(usage.depletes_at);
      if (abs) {
        lines.push(`⚠ Projected depletion: ${abs} (${fmtReset(usage.depletes_at)})`);
      } else if (fc.lasts_full_cycle) {
        lines.push(`✅ Pool outlasts the period (${fc.left_days}d to reset)`);
      }
      // Burn rate in $/day — basis for the projection
      if (fc.burn_usd_per_day != null) {
        lines.push(`🔥 Burn: $${fc.burn_usd_per_day}/day over ${fc.elapsed_days}d`);
      }
      // Shortfall: how much the rate must drop to survive until reset
      if (fc.deficit_days) {
        const cut = fc.reduction_factor ? ` · cut ×${fc.reduction_factor}` : '';
        const need = fc.sustainable_usd_per_day != null ? ` → $${fc.sustainable_usd_per_day}/day` : '';
        lines.push(`⚠ Short by ${fc.deficit_days}d${cut}${need}`);
      }
      if (lines.length) {
        depleteEl.innerHTML = lines.map(t => `<div class="ollama-depletion-line">${t}</div>`).join('');
        depleteEl.classList.add('active');
      } else {
        depleteEl.textContent = '';
        depleteEl.classList.remove('active');
      }
    }

    this.element.querySelector('.last-update').textContent = new Date().toLocaleTimeString();
  }
}

window.OllamaUsageWidget = OllamaUsageWidget;
