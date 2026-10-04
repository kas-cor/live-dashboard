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
          <div class="codex-reset-caption">Сброс лимита использования</div>
          <div class="codex-windows">
            ${this._windowBlock('primary', 'Лимит на 5 ч')}
            ${this._windowBlock('secondary', 'Недельный лимит')}
          </div>
          <a class="codex-reset-action" href="https://chatgpt.com/codex/cloud/settings/usage" target="_blank" rel="noopener noreferrer"
             title="В ChatGPT откройте Settings → Usage. Сброс может быть платным и доступен не всем.">Открыть настройки использования</a>
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
        </div>
        <div class="metric">
          <div class="progress-bar"><div class="progress-fill codex-fill-${which}" style="width:0%"></div></div>
          <span class="metric-value codex-value-${which}">--%</span>
        </div>
        <div class="codex-window-reset usage-reset-${which}">Время сброса не указано</div>
      </div>
    `;
  }

  // 18000s -> "5h window", 604800s -> "Weekly"
  _windowLabel(w) {
    const sec = w.window_seconds || 0;
    if (sec <= 0) return null;
    const hours = Math.round(sec / 3600);
    if (hours < 48) return `Лимит на ${hours} ч`;
    return 'Недельный лимит';
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
      if (secs <= 0) return 'сейчас';
      const days = Math.floor(secs / 86400);
      const hours = Math.floor((secs % 86400) / 3600);
      const mins = Math.floor((secs % 3600) / 60);
      if (days > 0) return `${days} д ${hours} ч`;
      if (hours > 0) return `${hours} ч ${mins} мин`;
      return mins > 0 ? `${mins} мин` : 'менее 1 мин';
    };

    const fmtAbs = (epoch) => {
      if (!epoch) return null;
      const dt = new Date(epoch * 1000);
      if (isNaN(dt)) return null;
      return new Intl.DateTimeFormat('ru-RU', { dateStyle: 'short', timeStyle: 'short' }).format(dt);
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
        const resetAt = Number.isFinite(w.reset_at) && w.reset_at > 0 ? w.reset_at : null;
        const resetIn = Number.isFinite(w.reset_in_seconds) && w.reset_in_seconds > 0
          ? w.reset_in_seconds
          : null;
        const remaining = resetAt !== null
          ? Math.max(0, resetAt - Date.now() / 1000)
          : resetIn;
        const abs = fmtAbs(resetAt);
        resetEl.textContent = remaining === null
          ? 'Время сброса не указано'
          : `Сброс через ${fmtRel(remaining)}${abs ? ` · ${abs}` : ''}`;
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
