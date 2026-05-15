class TailscaleWidget extends BaseWidget {
  constructor(id, options) {
    super(id, options);
    this.size = options.size || 'medium';
    this.apiUrl = options.apiUrl || '/api/tailscale';
    this._defaultConfig = {
      showOffline: true,
      showTraffic: true,
      showOS: true
    };
    this._configSchema = [
      { key: 'showOffline', label: 'Show offline peers', type: 'checkbox' },
      { key: 'showTraffic', label: 'Show TX/RX traffic', type: 'checkbox' },
      { key: 'showOS', label: 'Show OS info', type: 'checkbox' }
    ];
  }

  formatBytes(n) {
    if (!n || n === 0) return '0';
    const units = ['', 'K', 'M', 'G', 'T'];
    let i = 0;
    let v = n;
    while (v >= 1024 && i < units.length - 1) { v /= 1024; i++; }
    return v.toFixed(1) + units[i];
  }

  render() {
    this.element.innerHTML = `
      <div class="widget-header">
        <h3>Tailscale</h3>
        <div class="widget-header-actions">
          ${this.hasSettings() ? '<button class="widget-settings-btn" title="Settings">⚙</button>' : ''}
          <span class="last-update">--:--</span>
        </div>
      </div>
      <div class="widget-body">
        <div class="tailscale-self" id="ts-self"></div>
        <div class="tailscale-list" id="ts-list"></div>
      </div>
    `;
    this.element.classList.add('widget-scroll');
    const btn = this.element.querySelector('.widget-settings-btn');
    if (btn) btn.addEventListener('click', () => this.toggleSettings());
  }

  async update() {
    const showOffline = this.getConfig('showOffline', true);
    const showTraffic = this.getConfig('showTraffic', true);
    const showOS = this.getConfig('showOS', true);
    let d;
    try { d = await (await fetch(this.apiUrl)).json(); } catch(e) { d = {self:{},peers:[]}; }
    const selfEl = this.element.querySelector('#ts-self');
    if(selfEl) {
      if (d.self && d.self.name) {
        selfEl.innerHTML = `<div class="metric inline"><span class="metric-label">This node</span><span class="metric-value">${d.self.name} (${d.self.ip})</span></div>`;
      } else {
        selfEl.innerHTML = '';
      }
    }
    const list = this.element.querySelector('#ts-list');
    if(list) {
      let peers = d.peers;
      if (!showOffline) peers = peers.filter(p => p.online);
      list.innerHTML = peers.map(p => {
        const statusClass = p.online ? 'status-online' : 'status-offline';
        const statusText = p.online ? 'active' : (p.lastseen ? `offline \u00B7 ${p.lastseen}` : 'offline');
        const txRx = showTraffic && p.online && p.tx ? `tx ${this.formatBytes(p.tx)} rx ${this.formatBytes(p.rx)}` : '';
        const relayText = p.relay ? ' \u00B7 relay' : '';
        const osText = showOS ? ` <small>${p.os}</small>` : '';
        return `
          <div class="tail-peer">
            <span class="status-indicator ${statusClass}"></span>
            <div class="tail-peer-info">
              <div class="tail-peer-name">${p.name}${osText}</div>
              <div class="tail-peer-ip">${p.ip}${relayText}${txRx ? ' \u00B7 ' + txRx : ''}</div>
            </div>
            <div class="tail-peer-status">${statusText}</div>
          </div>
        `;
      }).join('');
    }
    this.element.querySelector('.last-update').textContent = new Date().toLocaleTimeString();
  }
}
window.TailscaleWidget = TailscaleWidget;
