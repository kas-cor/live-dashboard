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
            ${this._windowBlock('primary', '5-hour limit')}
            ${this._windowBlock('secondary', 'Weekly limit')}
          </div>
          <div class="codex-credits"></div>
          <div class="codex-reset-credits"></div>
        </div>
      </div>
    `;
  }

  _windowBlock(which, fallbackTitle) {
    return `
      <div class="codex-window-block">
        <div class="codex-window-header">
          <span class="codex-window-title codex-window-title-${which}">${fallbackTitle}</span>
          <span class="codex-window-reset usage-reset-${which}">Reset: --</span>
        </div>
        <div class="metric">
          <div class="progress-bar"><div class="progress-fill codex-fill-${which}" style="width:0%"></div></div>
          <span class="metric-value codex-value-${which}">--%</span>
        </div>
        <div class="codex-window-forecast usage-forecast-${which}">Collecting usage history</div>
      </div>
    `;
  }

  // 18000s -> "5h window", 604800s -> "Weekly"
  _windowLabel(w) {
    const sec = w.window_seconds || 0;
    if (sec <= 0) return null;
    const hours = Math.round(sec / 3600);
    if (hours < 48) return `${hours}-hour limit`;
    return 'Weekly limit';
  }

  _usageHistory(which, window, fetchedAtMs, nowMs) {
    if (!Number.isFinite(window.used_percent)) return [];
    const key = `codex-usage-history-v1-${which}`;
    const resetAt = Number.isFinite(window.reset_at) ? window.reset_at : null;
    let samples = [];
    try {
      samples = JSON.parse(localStorage.getItem(key) || '[]');
      if (!Array.isArray(samples)) samples = [];
    } catch (e) {
      samples = [];
    }
    samples = samples.filter((s) => Number.isFinite(s.at)
      && s.at <= nowMs + 5 * 60_000 && Number.isFinite(s.used) && s.used >= 0 && s.used <= 100);
    const newestAt = samples.reduce((newest, sample) => Math.max(newest, sample.at), -Infinity);
    if (fetchedAtMs < newestAt) return null;
    samples = samples.filter((s) => s.at <= fetchedAtMs);
    if (samples.length && (samples[samples.length - 1].resetAt !== resetAt
      || window.used_percent < samples[samples.length - 1].used)) {
      samples = []; // A reset-time change or usage drop starts a new cycle baseline.
    }
    const sameTimestamp = samples.find((s) => s.at === fetchedAtMs);
    if (sameTimestamp && sameTimestamp.used !== window.used_percent) return null;
    if (!sameTimestamp) {
      samples.push({ at: fetchedAtMs, used: window.used_percent, resetAt });
    }
    samples.sort((a, b) => a.at - b.at);
    samples = samples.slice(-72); // 6h at the 5-minute feed interval
    try { localStorage.setItem(key, JSON.stringify(samples)); } catch (e) { /* storage may be disabled */ }
    return samples;
  }

  _usageForecast(which, window, fetchedAtMs, nowMs, fmtRel) {
    if (!Number.isFinite(fetchedAtMs)) return 'Snapshot time unavailable';
    if (fetchedAtMs > nowMs + 5 * 60_000) return 'Snapshot timestamp is in the future';
    if (nowMs - fetchedAtMs > 15 * 60_000) return 'Usage data is stale';
    const used = Number(window.used_percent);
    if (!Number.isFinite(used) || used < 0 || used > 100) return 'Invalid usage percentage';
    if (used >= 100) return 'Limit exhausted';
    const history = this._usageHistory(which, window, fetchedAtMs, nowMs);
    if (history === null) return 'Received an older usage snapshot';
    const samples = history.filter((s) => fetchedAtMs - s.at <= 6 * 3600_000);
    if (samples.length < 2) return 'Not enough usage history';
    const first = samples[0];
    const last = samples[samples.length - 1];
    const elapsedHours = (last.at - first.at) / 3600_000;
    const usedChange = last.used - first.used;
    if (elapsedHours < 0.25 || usedChange <= 0) return 'Not enough data to estimate usage rate';

    const ratePerHour = usedChange / elapsedHours;
    const projectedUsed = Math.min(100, used + ratePerHour * Math.max(0, nowMs - fetchedAtMs) / 3600_000);
    const exhaustSeconds = (100 - projectedUsed) / ratePerHour * 3600;
    const resetSeconds = Number.isFinite(window.reset_at)
      ? Math.max(0, window.reset_at - nowMs / 1000)
      : null;
    const result = resetSeconds === null ? 'Expected to last about'
      : exhaustSeconds >= resetSeconds ? 'Enough' : 'Not enough';
    const resetText = resetSeconds === null ? '' : `, reset in ${fmtRel(resetSeconds)}`;
    const endText = resetSeconds === null
      ? ` ${fmtRel(exhaustSeconds)} at the current rate`
      : `: limit expected to run out in ${fmtRel(exhaustSeconds)}${resetText}`;
    return result + endText;
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
      if (secs <= 0) return 'now';
      const days = Math.floor(secs / 86400);
      const hours = Math.floor((secs % 86400) / 3600);
      const mins = Math.floor((secs % 3600) / 60);
      if (days > 0) return `${days}d ${hours}h`;
      if (hours > 0) return `${hours}h ${mins}m`;
      return mins > 0 ? `${mins}m` : '<1m';
    };

    const fmtAbs = (epoch) => {
      if (!epoch) return null;
      const dt = new Date(epoch * 1000);
      if (isNaN(dt)) return null;
      return new Intl.DateTimeFormat('en-US', {
        month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
      }).format(dt);
    };

    const parsedFetchedAt = Date.parse(d.fetched_at);
    const fetchedAtMs = Number.isFinite(parsedFetchedAt) ? parsedFetchedAt : null;

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
          ? 'Reset: --'
          : `Reset: ${abs || `in ${fmtRel(remaining)}`}${abs ? ` · in ${fmtRel(remaining)}` : ''}`;
      }

      const forecastEl = body.querySelector(`.usage-forecast-${which}`);
      if (forecastEl) {
        const forecast = this._usageForecast(which, w, fetchedAtMs, Date.now(), fmtRel);
        forecastEl.textContent = forecast;
        forecastEl.classList.remove('is-ok', 'is-warn');
        if (forecast.startsWith('Enough')) forecastEl.classList.add('is-ok');
        if (forecast.startsWith('Not enough')) forecastEl.classList.add('is-warn');
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

    const resetCreditsEl = body.querySelector('.codex-reset-credits');
    if (resetCreditsEl) {
      const resets = d.reset_credits || {};
      const available = Number.isFinite(resets.available_count) ? resets.available_count : null;
      const applicable = Number.isFinite(resets.applicable_available_count)
        ? resets.applicable_available_count : null;
      const lines = [];
      if (available !== null || applicable !== null) {
        lines.push(`Resets: ${available} available · ${applicable} applicable now`);
      }
      for (const credit of Array.isArray(resets.credits) ? resets.credits : []) {
        if (!credit || typeof credit !== 'object') continue;
        const parts = [
          credit.id,
          credit.type,
          credit.status,
          credit.issued_at && `issued: ${credit.issued_at}`,
          credit.expires_at && `expires: ${credit.expires_at}`,
          credit.description,
        ].filter((value) => typeof value === 'string' && value.trim());
        if (parts.length) lines.push(parts.join(' · '));
      }
      resetCreditsEl.textContent = lines.join('\n');
      if (lines.length) resetCreditsEl.classList.add('is-visible');
      else resetCreditsEl.classList.remove('is-visible');
    }

    this.element.querySelector('.last-update').textContent = new Date().toLocaleTimeString();
  }
}

window.CodexUsageWidget = CodexUsageWidget;
