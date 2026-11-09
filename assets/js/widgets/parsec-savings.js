/** Parse and display Parsec CLI savings output in a structured format. */
class ParsecSavingsWidget extends BaseWidget {
  constructor(id, options = {}) {
    super(id, options);
    this.size = options.size || 'medium';
    this.apiUrl = options.apiUrl || '/api/parsec-savings';
  }

  parseSavingsOutput(text) {
    const lines = text.trim().split('\n');
    const data = {
      summary: {},
      input: {},
      cache: {},
      models: [],
      failOpen: {}
    };

    // Header: "proxy ledger — 79 request(s) / 13 conversation(s):"
    const headerMatch = lines[0].match(/proxy ledger — (\d+) request\(s\) \/ (\d+) conversation\(s\):/);
    if (headerMatch) {
      data.summary = {
        totalRequests: parseInt(headerMatch[1], 10),
        totalConversations: parseInt(headerMatch[2], 10)
      };
    }

    // Input line: "input: ... vs ... billed(+cache) → ~... tok saved (...%)"
    const inputMatch = lines[1].match(/input: (.+?) → ~(\d+) tok saved \(([\d.]+)%\)/);
    if (inputMatch) {
      data.input = {
        comparison: inputMatch[1],
        tokensSaved: parseInt(inputMatch[2], 10),
        savePercent: parseFloat(inputMatch[3])
      };
    }

    // Cache line: "cache: ... read / ... write (n/a) · freezer trimmed ~... tok (diagnostic)"
    const cacheMatch = lines[3].match(/cache: (\d+) read \/ (\d+) write.*freezer trimmed ~(\d+) tok/);
    if (cacheMatch) {
      data.cache = {
        reads: parseInt(cacheMatch[1], 10),
        writes: parseInt(cacheMatch[2], 10),
        freezerTrimmed: parseInt(cacheMatch[3], 10)
      };
    }

    // Model lines (lines 4-5 or 4-6)
    for (let i = 4; i < lines.length - 1; i++) {
      const modelMatch = lines[i].match(/(\S+): (\d+) req · ~(\d+) tok saved \(([\d.]+)%\)/);
      if (modelMatch) {
        data.models.push({
          name: modelMatch[1],
          requests: parseInt(modelMatch[2], 10),
          tokensSaved: parseInt(modelMatch[3], 10),
          savePercent: parseFloat(modelMatch[4])
        });
      }
    }

    // Fail-open line: "fail-open: ... request(s), ... scorer step(s) · ... null probe(s) excluded"
    const failMatch = lines[lines.length - 1].match(/fail-open: (\d+) request\(s\), (\d+) scorer step\(s\) · (\d+) null probe\(s\) excluded/);
    if (failMatch) {
      data.failOpen = {
        requests: parseInt(failMatch[1], 10),
        scorerSteps: parseInt(failMatch[2], 10),
        nullProbes: parseInt(failMatch[3], 10)
      };
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
          <div class="parsec-savings-loading">Загрузка...</div>
        </div>
      </div>`;
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
      if (container && !container.innerHTML) {
        container.innerHTML = '<div class="parsec-savings-error">Не удалось получить отчёт Parsec.</div>';
        container.setAttribute('aria-busy', 'false');
      }
    }
  }

  renderParsedData(data) {
    if (!data.summary.totalRequests) {
      return '<div class="parsec-savings-empty">Нет данных для отображения</div>';
    }

    return `
      <div class="parsec-savings-card">
        <!-- Summary -->
        <div class="parsec-section">
          <div class="parsec-row parsec-summary">
            <span class="parsec-label">Итого</span>
            <span class="parsec-value">${data.summary.totalRequests} запросов / ${data.summary.totalConversations} диалогов</span>
          </div>
        </div>

        <!-- Input Savings -->
        ${data.input.tokensSaved ? `
        <div class="parsec-section">
          <div class="parsec-row">
            <span class="parsec-label">Токены спёржены</span>
            <span class="parsec-value">${data.input.tokensSaved?.toLocaleString()} tok (${data.input.savePercent}%)</span>
          </div>
          <div class="parsec-input-detail">
            <span class="parsec-input-comparison">${data.input.comparison}</span>
          </div>
        </div>` : ''}

        <!-- Cache -->
        <div class="parsec-section">
          <div class="parsec-row">
            <span class="parsec-label">Кеш</span>
            <span class="parsec-value">${data.cache.reads?.toLocaleString()} чтений / ${data.cache.writes?.toLocaleString()} записей</span>
          </div>
          ${data.cache.freezerTrimmed ? `
          <div class="parsec-row parsec-freezer">
            <span class="parsec-label">Freezer</span>
            <span class="parsec-value">${data.cache.freezerTrimmed?.toLocaleString()} tok обрезано</span>
          </div>` : ''}
        </div>

        <!-- Models -->
        ${data.models.length ? `
        <div class="parsec-section">
          <div class="parsec-section-title">Модели</div>
          ${data.models.map(model => `
            <div class="parsec-model-row">
              <span class="parsec-model-name">${model.name}</span>
              <span class="parsec-model-stats">
                <span class="parsec-model-request">${model.requests} запрос</span>
                <span class="parsec-model-tokens">${model.tokensSaved?.toLocaleString()} tok (${model.savePercent}%)</span>
              </span>
            </div>
          `).join('')}
        </div>` : ''}

        <!-- Fail-open -->
        ${data.failOpen.requests !== undefined ? `
        <div class="parsec-section">
          <div class="parsec-row">
            <span class="parsec-label">Fail-open</span>
            <span class="parsec-value">${data.failOpen.requests} запросов</span>
          </div>
          <div class="parsec-row parsec-fail-detail">
            <span class="parsec-label">Скоря шагов: ${data.failOpen.scorerSteps}</span>
            <span class="parsec-label">Нулевых проб: ${data.failOpen.nullProbes}</span>
          </div>
        </div>` : ''}
      </div>
    `;
  }
}

window.ParsecSavingsWidget = ParsecSavingsWidget;