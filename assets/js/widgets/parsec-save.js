/**
 * Parsec save tokens — live savings of the local parsec proxy.
 *
 * Data: GET /api/parsec-save (backend computes it read-only from
 * ~/.parsec/ledger.jsonl with Ollama prices, peak window included).
 * The endpoint returns all three windows in one payload, so switching
 * 24ч / 7д / всё is instant and does not refetch.
 */
class ParsecSaveWidget extends BaseWidget {
  constructor(id, options) {
    super(id, options);
    this.size = options.size || 'medium';
    this.apiUrl = options.apiUrl || '/api/parsec-save';
    this.windowKey = options.window || '24h';
    this._defaultConfig = {};
    this._configSchema = [];
    this.data = null;
  }

  render() {
    const windows = [['24h', '24ч'], ['7d', '7д'], ['all', 'всё']];
    const buttons = windows.map(([key, label]) =>
      `<button type="button" class="parsec-window-btn${key === this.windowKey ? ' is-active' : ''}"
        data-window="${key}">${label}</button>`).join('');

    this.element.innerHTML = `
      <div class="widget-header">
        <h3>💸 Parsec save</h3>
        <div class="widget-header-actions">
          <span class="parsec-windows" role="group" aria-label="Окно">${buttons}</span>
          <span class="last-update">--:--</span>
        </div>
      </div>
      <div class="widget-body parsec-body">
        <div class="parsec-hero">
          <div class="parsec-hero-main">
            <span class="parsec-hero-value" data-f="tokens_saved">—</span>
            <span class="parsec-hero-label">токенов сэкономлено</span>
          </div>
          <div class="parsec-hero-side">
            <div class="parsec-hero-line"><span class="parsec-usd-saved" data-f="usd_saved">—</span> экономии</div>
            <div class="parsec-hero-line"><span class="parsec-usd-cost" data-f="usd_cost">—</span> расход</div>
          </div>
        </div>
        <div class="parsec-metrics">
          <div class="parsec-metric"><div class="parsec-metric-label">Запросы</div>
            <div class="parsec-metric-value" data-f="requests">—</div>
            <div class="parsec-metric-sub" data-f="requests_sub"></div></div>
          <div class="parsec-metric"><div class="parsec-metric-label">Cache read</div>
            <div class="parsec-metric-value" data-f="cache_read">—</div>
            <div class="parsec-metric-sub">кэш промпта</div></div>
          <div class="parsec-metric"><div class="parsec-metric-label">Output</div>
            <div class="parsec-metric-value" data-f="output">—</div>
            <div class="parsec-metric-sub">токенов ответа</div></div>
          <div class="parsec-metric"><div class="parsec-metric-label">Оплачено вход</div>
            <div class="parsec-metric-value" data-f="billed_in">—</div>
            <div class="parsec-metric-sub">после сжатия</div></div>
          <div class="parsec-metric"><div class="parsec-metric-label">Было бы</div>
            <div class="parsec-metric-value" data-f="counterfactual_in">—</div>
            <div class="parsec-metric-sub">без parsec</div></div>
          <div class="parsec-metric"><div class="parsec-metric-label">Экономия</div>
            <div class="parsec-metric-value" data-f="saved_pct">—</div>
            <div class="parsec-metric-sub" data-f="saved_sub">от промпта</div></div>
        </div>
        <div class="models-header">по моделям</div>
        <div class="models-list" data-models></div>
        <div class="parsec-foot" data-foot></div>
      </div>`;

    this.element.querySelectorAll('.parsec-window-btn').forEach(btn => {
      btn.addEventListener('click', () => this.setWindow(btn.dataset.window));
    });
  }

  setWindow(key) {
    this.windowKey = key;
    this.element.querySelectorAll('.parsec-window-btn').forEach(btn => {
      btn.classList.toggle('is-active', btn.dataset.window === key);
    });
    this.paint();
  }

  _set(field, text) {
    const el = this.element.querySelector(`[data-f="${field}"]`);
    if (el) el.textContent = text;
  }

  _tokens(n) {
    if (n === null || n === undefined) return '—';
    const abs = Math.abs(n);
    for (const [limit, suffix] of [[1e9, 'B'], [1e6, 'M'], [1e3, 'k']]) {
      if (abs >= limit) return (n / limit).toFixed(2).replace(/\.00$/, '') + suffix;
    }
    return String(n);
  }

  _usd(n) {
    if (n === null || n === undefined) return '—';
    return '$' + Number(n).toFixed(2);
  }

  _int(n) {
    return (n === null || n === undefined) ? '—' : Number(n).toLocaleString('ru-RU');
  }

  async update() {
    let payload;
    try {
      const res = await fetch(this.apiUrl, { cache: 'no-store' });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      payload = await res.json();
    } catch (err) {
      this.setError('parsec-save: ' + err.message);
      return;
    }

    if (payload.error) {
      this.setError(payload.error === 'no_ledger'
        ? 'нет ledger: ' + (payload.ledger || '?')
        : payload.error + ': ' + (payload.detail || ''));
      return;
    }

    this.data = payload;
    this.paint();

    const stamp = this.element.querySelector('.last-update');
    if (stamp) {
      const gen = payload.generated_at ? new Date(payload.generated_at) : new Date();
      stamp.textContent = gen.toLocaleTimeString('ru-RU', { hour12: false });
      stamp.title = `ledger: ${payload.ledger?.rows || 0} строк, `
        + `не измерено: ${payload.ledger?.unmeasured_total || 0}`;
    }
  }

  paint() {
    if (!this.data || !this.data.windows) return;
    const win = this.data.windows[this.windowKey];
    if (!win) return;

    this._set('tokens_saved', this._tokens(win.tokens_saved));
    this._set('usd_saved', this._usd(win.usd_saved));
    this._set('usd_cost', this._usd(win.usd_cost));
    this._set('requests', this._int(win.requests));
    this._set('requests_sub', win.unmeasured_requests
      ? `${this._int(win.unmeasured_requests)} без замера` : 'все измерены');
    this._set('cache_read', this._tokens(win.cache_read));
    this._set('output', this._tokens(win.output));
    this._set('billed_in', this._tokens(win.billed_in));
    this._set('counterfactual_in', this._tokens(win.counterfactual_in));
    this._set('saved_pct',
      win.saved_pct_of_counterfactual ? win.saved_pct_of_counterfactual.toFixed(1) + '%' : '—');
    this._set('saved_sub',
      win.usd_saved_share_pct ? '−' + win.usd_saved_share_pct.toFixed(0) + '% счёта' : 'от промпта');

    const host = this.element.querySelector('[data-models]');
    if (host) {
      const models = win.models || [];
      const max = Math.max(1, ...models.map(m => m.tokens_saved || 0));
      host.innerHTML = models.map(m => `
        <div class="model-row" title="${m.model}: ${this._int(m.requests)} запросов">
          <span class="model-name">${m.model}</span>
          <span class="model-bar-track"><span class="model-bar-fill"
            style="width:${Math.max(2, Math.round(100 * (m.tokens_saved || 0) / max))}%"></span></span>
          <span class="model-cost">${this._usd(m.usd_saved)}</span>
          <span class="model-reqs">${m.requests}</span>
        </div>`).join('') || '<div class="parsec-foot">нет данных</div>';
    }

    const foot = this.element.querySelector('[data-foot]');
    if (foot) {
      const bits = [];
      if (win.since) bits.push('с ' + new Date(win.since).toLocaleString('ru-RU', { hour12: false }));
      if (win.peak_requests) bits.push(`пиковых запросов: ${win.peak_requests}`);
      if (win.unpriced_models && win.unpriced_models.length) {
        bits.push('нет цен: ' + win.unpriced_models.join(', '));
      }
      foot.textContent = bits.join(' · ');
    }
  }
}

window.ParsecSaveWidget = ParsecSaveWidget;
