class PromotionsWidget extends BaseWidget {
  constructor(id, options) {
    super(id, options);
    this.size = options.size || 'medium';
    this.apiUrl = options.apiUrl || '/api/promotions';
    this._defaultConfig = {
      title: '🏷️ Акции',
      highlightExpiring: true,
      expiringDays: 3,
    };
    this._configSchema = [
      { key: 'title', label: 'Widget title', type: 'text' },
      { key: 'highlightExpiring', label: 'Подсвечивать заканчивающиеся', type: 'checkbox' },
      { key: 'expiringDays', label: 'Сколько дней до конца считать «скоро»', type: 'number' },
    ];
  }

  render() {
    const title = this.getConfig('title', '🏷️ Акции');
    this.element.innerHTML = `
      <div class="widget-header">
        <h3>${title}</h3>
        <div class="widget-header-actions">
          <span class="last-update">--:--</span>
          ${this.hasSettings() ? '<button class="widget-settings-btn" title="Settings">⚙</button>' : ''}
        </div>
      </div>
      <div class="widget-body" id="promo-${this.id}">
        <div class="promo-list">Loading...</div>
      </div>
    `;
    this.element.classList.add('widget-scroll');
    const btn = this.element.querySelector('.widget-settings-btn');
    if (btn) btn.addEventListener('click', () => this.toggleSettings());
  }

  async update() {
    const title = this.getConfig('title', '🏷️ Акции');
    const h3 = this.element.querySelector('.widget-header h3');
    if (h3) h3.textContent = title;

    let d;
    try { d = await (await fetch(this.apiUrl)).json(); }
    catch(e) { return; }

    const body = this.element.querySelector('.widget-body');
    if (!body) return;

    if (!d.promotions || d.promotions.length === 0) {
      body.innerHTML = '<div class="promo-list"><div class="promo-empty">Нет активных акций</div></div>';
      this.element.querySelector('.last-update').textContent = new Date().toLocaleTimeString();
      return;
    }

    const highlight = this.getConfig('highlightExpiring', true);
    const expiringDays = this.getConfig('expiringDays', 3);
    const now = new Date();

    const cards = d.promotions.map(p => {
      const endDate = new Date(p.end_date + 'T23:59:59');
      const remaining = Math.ceil((endDate - now) / 86400000);
      const isExpiring = highlight && remaining >= 0 && remaining <= expiringDays;
      const isExpired = remaining < 0;

      let timeStr = '';
      let timeClass = '';
      if (isExpired) {
        timeStr = '❌ Завершена';
        timeClass = 'promo-expired';
      } else if (isExpiring) {
        timeStr = `⚠️ Осталось ${remaining} дн.`;
        timeClass = 'promo-expiring';
      } else if (remaining <= 7) {
        timeStr = `⏰ ${remaining} дн.`;
        timeClass = 'promo-week';
      } else {
        timeStr = `📅 ${remaining} дн.`;
      }

      const endFormatted = endDate.toLocaleDateString('ru-RU', {
        day: 'numeric', month: 'short'
      });

      return `
        <div class="promo-card ${isExpiring ? 'promo-card-expiring' : ''}">
          <div class="promo-header">
            <span class="promo-brand">${this._escape(p.brand)}</span>
            <span class="promo-time ${timeClass}">${timeStr}</span>
          </div>
          ${p.description ? `<div class="promo-description">${this._escape(p.description)}</div>` : ''}
          ${p.benefit ? `<div class="promo-benefit">🎁 ${this._escape(p.benefit)}</div>` : ''}
          ${p.terms ? `<details class="promo-terms"><summary>📋 Условия</summary>${this._escape(p.terms)}${p.url ? ` <a href="${this._escape(p.url)}" target="_blank" class="promo-link">Подробнее →</a>` : ''}</details>` : ''}
          ${!p.terms && p.url ? `<div class="promo-url"><a href="${this._escape(p.url)}" target="_blank" class="promo-link">Подробнее →</a></div>` : ''}
          <div class="promo-footer">
            <span class="promo-end">до ${endFormatted}</span>
            ${p.source ? `<span class="promo-source">📬 ${this._escape(p.source)}</span>` : ''}
          </div>
        </div>
      `;
    }).join('');

    body.innerHTML = `
      <div class="promo-list">
        ${cards}
      </div>
      <div class="promo-summary">Всего: ${d.promotions.length} активных</div>
    `;

    this.element.querySelector('.last-update').textContent = new Date().toLocaleTimeString();
  }

  _escape(str) {
    if (!str) return '';
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }
}

window.PromotionsWidget = PromotionsWidget;
