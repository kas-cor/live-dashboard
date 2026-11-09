/** Show the exact text emitted by the installed Parsec CLI. */
class ParsecSavingsWidget extends BaseWidget {
  constructor(id, options = {}) {
    super(id, options);
    this.size = options.size || 'medium';
    this.apiUrl = options.apiUrl || '/api/parsec-savings';
  }

  render() {
    // Static template only; CLI output is always inserted with textContent.
    this.element.innerHTML = `
      <div class="widget-header">
        <h3>Parsec savings</h3>
        <span class="last-update">--:--</span>
      </div>
      <div class="widget-body">
        <pre class="parsec-savings-output" aria-live="polite" aria-busy="true">Загрузка…</pre>
      </div>`;
  }

  async update() {
    const output = this.element.querySelector('.parsec-savings-output');
    const stamp = this.element.querySelector('.last-update');

    try {
      const response = await fetch(this.apiUrl, { cache: 'no-store' });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const payload = await response.json();
      if (payload.error) throw new Error(payload.error);

      output.textContent = payload.output || 'Команда вернула пустой вывод.';
      output.setAttribute('aria-busy', 'false');
      if (stamp && payload.generated_at) {
        stamp.textContent = new Date(payload.generated_at).toLocaleTimeString('ru-RU', { hour12: false });
      }
    } catch (error) {
      this.setError(`parsec-savings: ${error.message}`);
      if (output && !output.textContent) {
        output.textContent = 'Не удалось получить отчёт Parsec.';
        output.setAttribute('aria-busy', 'false');
      }
    }
  }
}

window.ParsecSavingsWidget = ParsecSavingsWidget;
