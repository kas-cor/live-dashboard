/** Parse and display Parsec CLI savings output in a structured format. */
class ParsecSavingsWidget extends BaseWidget {
  constructor(id, options = {}) {
    super(id, options);
    this.size = options.size || 'medium';
    this.apiUrl = options.apiUrl || '/api/parsec-savings';
  }

  parseSavingsOutput(text) {
    const data = {
      summary: {},
      input: {},
      cache: {},
      models: [],
      failOpen: {}
    };
    const lines = text.trim().split('\n');
    const number = (value) => Number(value.replaceAll(',', ''));
    for (const line of lines) {
      const header = line.match(/proxy ledger — ([\d,]+) request\(s\) \/ ([\d,]+) conversation\(s\):/);
      if (header) data.summary = { totalRequests: number(header[1]), totalConversations: number(header[2]) };

      const input = line.match(/input: ([\d,]+) counterfactual vs ([\d,]+) billed\(\+cache\) → ~?([\d,]+) tok saved \(([\d.]+)%\)/);
      if (input) data.input = {
        counterfactualTokens: number(input[1]),
        billedTokens: number(input[2]),
        tokensSaved: number(input[3]),
        savePercent: parseFloat(input[4])
      };

      const cache = line.match(/cache: ([\d,]+) read \/ ([\d,]+) write.*?freezer trimmed ~([\d,]+) tok/);
      if (cache) data.cache = { reads: number(cache[1]), writes: number(cache[2]), freezerTrimmed: number(cache[3]) };

      const model = line.match(/^\s+(\S+): ([\d,]+) req · ~?([\d,]+) tok saved \(([\d.]+)%\)/);
      if (model) data.models.push({ name: model[1], requests: number(model[2]), tokensSaved: number(model[3]), savePercent: parseFloat(model[4]) });

      const fail = line.match(/fail-open: (\d+) request\(s\), (\d+) scorer step\(s\) · (\d+) null probe\(s\) excluded/);
      if (fail) data.failOpen = { requests: number(fail[1]), scorerSteps: number(fail[2]), nullProbes: number(fail[3]) };
    }

    return data;
  }

  render() {
    this.element.innerHTML = `
      <div class="widget-header">
        <h3>Parsec Savings</h3>
        <span class="last-update">--:--</span>
      </div>
      <div class="widget-body">
        <div class="parsec-savings-container" aria-live="polite" aria-busy="true">
          <div class="parsec-savings-loading">Loading…</div>
        </div>
      </div>`;
    this.element.classList.add('widget-scroll');
  }

  async update() {
    const container = this.element.querySelector('.parsec-savings-container');
    const stamp = this.element.querySelector('.last-update');

    try {
      const response = await fetch(this.apiUrl, { cache: 'no-store' });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const payload = await response.json();
      if (payload.error) throw new Error(payload.error);

      const data = this.parseSavingsOutput(payload.output || '');
      container.innerHTML = this.renderParsedData(data);
      container.setAttribute('aria-busy', 'false');
      if (stamp && payload.generated_at) {
        stamp.textContent = new Date(payload.generated_at).toLocaleTimeString('ru-RU', { hour12: false });
      }
    } catch (error) {
      this.setError(`parsec-savings: ${error.message}`);
      if (container) {
        container.innerHTML = '<div class="parsec-savings-error">Could not load the Parsec report.</div>';
        container.setAttribute('aria-busy', 'false');
      }
    }
  }

  escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, (char) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    })[char]);
  }

  formatCompactTokens(value) {
    return new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 }).format(value);
  }

  renderParsedData(data) {
    if (!data.summary.totalRequests) {
      return '<div class="parsec-savings-empty">No savings data available.</div>';
    }

    return `
      <div class="parsec-savings-card">
        <div class="parsec-summary-grid">
          <div class="parsec-stat"><span class="parsec-stat-label">Requests</span><strong>${data.summary.totalRequests.toLocaleString()}</strong></div>
          <div class="parsec-stat"><span class="parsec-stat-label">Conversations</span><strong>${data.summary.totalConversations.toLocaleString()}</strong></div>
        </div>

        ${data.input.tokensSaved ? `
        <section class="parsec-saved-summary">
          <div><span class="parsec-stat-label">Tokens saved</span><strong>${data.input.tokensSaved.toLocaleString()}</strong></div>
          <span class="parsec-saved-percent">${data.input.savePercent}%</span>
        </section>
        ${data.input.counterfactualTokens != null && data.input.billedTokens != null ? `
        <div class="parsec-input-summary">
          <div class="parsec-input-stat"><span>Baseline</span><strong title="${data.input.counterfactualTokens.toLocaleString()} tokens">${this.formatCompactTokens(data.input.counterfactualTokens)}</strong></div>
          <span class="parsec-input-arrow" aria-hidden="true">→</span>
          <div class="parsec-input-stat"><span>Billed</span><strong title="${data.input.billedTokens.toLocaleString()} tokens">${this.formatCompactTokens(data.input.billedTokens)}</strong></div>
        </div>` : ''}
        ` : ''}

        <div class="parsec-cache-grid">
          <div class="parsec-cache-stat"><span>Cache reads</span><strong>${this.formatCompactTokens(data.cache.reads || 0)}</strong></div>
          <div class="parsec-cache-stat"><span>Writes</span><strong>${data.cache.writes?.toLocaleString()}</strong></div>
          ${data.cache.freezerTrimmed ? `<div class="parsec-cache-stat parsec-cache-stat-full"><span>Freezer trimmed</span><strong>${this.formatCompactTokens(data.cache.freezerTrimmed)} tokens</strong></div>` : ''}
        </div>

        <!-- Models -->
        ${data.models.length ? `
        <div class="parsec-section">
          <div class="parsec-section-title">Models (${data.models.length})</div>
          <div class="parsec-model-list">${data.models.map(model => `
            <div class="parsec-model-row">
              <span class="parsec-model-name">${this.escapeHtml(model.name)}</span>
              <span class="parsec-model-request">${model.requests.toLocaleString()} req</span>
              <span class="parsec-model-tokens">${this.formatCompactTokens(model.tokensSaved)} tokens · ${model.savePercent}%</span>
            </div>
          `).join('')}</div>
        </div>` : ''}

        <!-- Fail-open -->
        ${data.failOpen.requests !== undefined ? `
        <div class="parsec-section">
          <div class="parsec-row">
            <span class="parsec-label">Fail-open</span>
            <span class="parsec-value">${data.failOpen.requests} requests</span>
          </div>
          <div class="parsec-fail-detail">
            <span class="parsec-fail-stat"><span class="parsec-label">Scorer steps</span><strong>${data.failOpen.scorerSteps}</strong></span>
            <span class="parsec-fail-stat"><span class="parsec-label">Null probes</span><strong>${data.failOpen.nullProbes}</strong></span>
          </div>
        </div>` : ''}
      </div>
    `;
  }
}

window.ParsecSavingsWidget = ParsecSavingsWidget;