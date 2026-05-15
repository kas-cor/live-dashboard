class CryptoWidget extends BaseWidget {
  constructor(id, options) {
    super(id, options);
    this.size = options.size || 'medium';
    this.apiUrl = options.apiUrl || '/api/crypto';
    this._defaultConfig = {
      coins: 'bitcoin,ethereum,monero',
      showChange: true
    };
    this._configSchema = [
      { key: 'coins', label: 'Coins (comma-separated)', type: 'text' },
      { key: 'showChange', label: 'Show 24h change', type: 'checkbox' }
    ];
    this.labels = {bitcoin:'BTC',ethereum:'ETH',monero:'XMR',solana:'SOL',cardano:'ADA',dogecoin:'DOGE',litecoin:'LTC',ripple:'XRP',polkadot:'DOT',binancecoin:'BNB',chainlink:'LINK',polygon:'MATIC',avalanche:'AVAX',cosmos:'ATOM',near:'NEAR',aptos:'APT',sui:'SUI',pepe:'PEPE',shiba:'SHIB',tether:'USDT', 'the-open-network':'TON'};
  }

  render() {
    this.element.innerHTML = `
      <div class="widget-header">
        <h3>Crypto</h3>
        <div class="widget-header-actions">
          ${this.hasSettings() ? '<button class="widget-settings-btn" title="Settings">⚙</button>' : ''}
          <span class="last-update">--:--</span>
        </div>
      </div>
      <div class="widget-body crypto-grid" id="crypto-grid"></div>
    `;
    const btn = this.element.querySelector('.widget-settings-btn');
    if (btn) btn.addEventListener('click', () => this.toggleSettings());
  }

  async update() {
    const coinsStr = this.getConfig('coins', 'bitcoin,ethereum,monero');
    const showChange = this.getConfig('showChange', true);
    const coins = coinsStr.split(',').map(c => c.trim()).filter(Boolean);
    let d;
    try { d = await (await fetch(`${this.apiUrl}?ids=${encodeURIComponent(coinsStr)}`)).json(); } catch(e) { return; }
    const grid = this.element.querySelector('#crypto-grid');
    if(!grid) return;
    grid.innerHTML = coins.map(c => {
      const coin = d[c] || {price:0,change24:0};
      const price = coin.price ? coin.price.toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2}) : '--';
      const cls = coin.change24 >= 0 ? 'positive' : 'negative';
      const arrow = coin.change24 >= 0 ? '\u25B2' : '\u25BC';
      const changeHtml = showChange ? `<div class="crypto-change ${cls}">${arrow} ${Math.abs(coin.change24||0).toFixed(2)}%</div>` : '';
      return `
        <div class="crypto-row">
          <div class="crypto-name">${this.labels[c]||c.toUpperCase()}</div>
          <div class="crypto-price">$${price}</div>
          ${changeHtml}
        </div>
      `;
    }).join('');
    this.element.querySelector('.last-update').textContent = new Date().toLocaleTimeString();
  }
}
window.CryptoWidget = CryptoWidget;
