class CodexUsageWidget extends BaseWidget {
  constructor(id, options) {
    super(id, options);
    this.size = options.size || 'medium';
    this.apiUrl = options.apiUrl || '/api/codex-usage';
    this._defaultConfig = {};
    this._configSchema = [];
  }

  render() {
    this.element.innerHTML = `
      <div class="widget-header">
        <h3>⚡ Codex Limits</h3>
        <div class="widget-header-actions">
          <span class="last-update">--:--</span>
        </div>
      </div>
      <div class="widget-body" id="codex-${this.id}">
        <div class="codex-card">
          <div class="codex-plan-line">Loading...</div>
          <div class="codex-windows">
            ${this._windowBlock('primary', 'Window 5h')}
            ${this._windowBlock('secondary', 'Weekly')}
          </div>
          <div class="codex-credits"></div>
        </div>
      </div>
    `;
  }

  _windowBlock(which, fallbackTitle) {
    return `
      <div class="codex-window-block">
        <div class="codex-window-header">
          <span class="codex-window-title codex-window-title-${which}">${fallbackTitle}</span>
          <span class="codex-window-reset usage-reset-${which}">resets: --</span>
        </div>
        <div class="metric">
          <div class="progress-bar"><div class="progress-fill codex-fill-${which}" style="width:0%"></div></div>
          <span class="metric-value codex-value-${which}">--%</span>
        </div>
      </div>
    `;
  }

  // 18000s -> "5h window", 604800s -> "Weekly"
  _windowLabel(w) {
    const sec = w.window_seconds || 0;
    if (sec <= 0) return null;
    const hours = Math.round(sec / 3600);
    if (hours < 48) return `${hours}h window`;
    return 'Weekly';
  }

  async update() {
    let d;
    try { d = await (await fetch(this.apiUrl)).json(); }
    catch(e) { return; }

    const body = this.element.querySelector('.widget-body');
    if (!body) return;

    if (d.error === 'no_data') {
      body.innerHTML = '<div class="codex-card"><div class="codex-plan-line">No data yet — waiting for first fetch...</div></div>';
      return;
    }

    // Plan line (safe: d.plan is a short constrained value from the OpenAI API,
    // e.g. "plus"; no user-controlled input)
    const planEl = body.querySelector('.codex-plan-line');
    const plan = (d.plan || 'unknown').charAt(0).toUpperCase() + (d.plan || 'unknown').slice(1);
    const reached = d.limit_reached ? ' <span class="codex-limit-badge">LIMIT REACHED</span>' : '';
    if (planEl) planEl.innerHTML = `<span class="status-indicator status-online"></span> ${plan} · Codex${reached}`;

    const fmtRel = (secs) => {
      if (!secs || secs <= 0) return 'now';
      const days = Math.floor(secs / 86400);
      const hours = Math.floor((secs % 86400) / 3600);
      const mins = Math.floor((secs % 3600) / 60);
      if (days > 0) return `${days}d ${hours}h`;
      if (hours > 0) return `${hours}h ${mins}m`;
      return `${mins}m`;
    };

    const fmtAbs = (epoch) => {
      if (!epoch) return null;
      const dt = new Date(epoch * 1000);
      if (isNaN(dt)) return null;
      const p = (n) => String(n).padStart(2, '0');
      return `${p(dt.getDate())}.${p(dt.getMonth() + 1)}.${dt.getFullYear()} ${p(dt.getHours())}:${p(dt.getMinutes())}`;
    };

    for (const which of ['primary', 'secondary']) {
      const w = (d.windows || {})[which] || {};
      const pct = w.used_percent || 0;

      const titleEl = body.querySelector(`.codex-window-title-${which}`);
      if (titleEl) {
        const label = this._windowLabel(w);
        if (label) titleEl.textContent = label;
      }

      const bar = body.querySelector(`.codex-fill-${which}`);
      if (bar) {
        bar.style.width = Math.min(pct, 100) + '%';
        if (pct > 80) bar.style.background = '#ff5500';
        else if (pct > 50) bar.style.background = '#ffcc00';
        else bar.style.background = '#00ff88';
      }

      const valEl = body.querySelector(`.codex-value-${which}`);
      if (valEl) valEl.textContent = pct + '%';

      const resetEl = body.querySelector(`.usage-reset-${which}`);
      if (resetEl) {
        const abs = fmtAbs(w.reset_at);
        resetEl.textContent = abs ? `resets: ${abs} (${fmtRel(w.reset_in_seconds)})` : `resets: ${fmtRel(w.reset_in_seconds)}`;
      }
    }

    // Credits line
    const creditsEl = body.querySelector('.codex-credits');
    if (creditsEl) {
      const c = d.credits || {};
      if (c.unlimited) {
        creditsEl.textContent = 'Credits: unlimited';
        creditsEl.classList.add('unlimited');
      } else if (c.has_credits) {
        creditsEl.textContent = `Credits: $${c.balance} extra balance`;
        creditsEl.classList.remove('unlimited');
      } else {
        creditsEl.textContent = '';
        creditsEl.classList.remove('unlimited');
      }
    }

    this.element.querySelector('.last-update').textContent = new Date().toLocaleTimeString();
  }
}

window.CodexUsageWidget = CodexUsageWidget;
