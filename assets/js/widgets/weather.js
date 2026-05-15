class WeatherWidget extends BaseWidget {
  constructor(id, options) {
    super(id, options);
    this.size = options.size || 'small';
    this.apiUrl = options.apiUrl || '/api/weather';
    this._defaultConfig = {
      city: 'auto',
      showHumidity: true,
      showWind: true,
      showForecast: true,
      tempUnit: 'C'
    };
    this._configSchema = [
      { key: 'city', label: 'City (or "auto")', type: 'text' },
      { key: 'showHumidity', label: 'Show humidity', type: 'checkbox' },
      { key: 'showWind', label: 'Show wind', type: 'checkbox' },
      { key: 'showForecast', label: 'Show min/max', type: 'checkbox' },
      { key: 'tempUnit', label: 'Temperature unit', type: 'select', options: [
        { value: 'C', label: 'Celsius' },
        { value: 'F', label: 'Fahrenheit' }
      ]}
    ];
  }

  toF(c) { return Math.round(c * 9/5 + 32); }

  render() {
    this.element.innerHTML = `
      <div class="widget-header">
        <h3></h3>
        <div class="widget-header-actions">
          ${this.hasSettings() ? '<button class="widget-settings-btn" title="Settings">⚙</button>' : ''}
        </div>
      </div>
      <div class="widget-body weather-body">
        <div class="weather-main">
          <div class="weather-icon" id="w-icon">🌡️</div>
          <div class="weather-temp" id="w-temp">--°</div>
        </div>
        <div class="weather-city" id="w-city">--</div>
        <div class="weather-details">
          <span id="w-hum-wrap">💧 <span id="w-hum">--%</span></span>
          <span id="w-wind-wrap">💨 <span id="w-wind">--</span> m/s</span>
        </div>
        <div class="weather-forecast" id="w-forecast">-- / --</div>
      </div>
    `;
    const btn = this.element.querySelector('.widget-settings-btn');
    if (btn) btn.addEventListener('click', () => this.toggleSettings());
    this._applyConfig();
  }

  _applyConfig() {
    const humWrap = this.element.querySelector('#w-hum-wrap');
    const windWrap = this.element.querySelector('#w-wind-wrap');
    const forecast = this.element.querySelector('#w-forecast');
    if (humWrap) humWrap.style.display = this.getConfig('showHumidity', true) ? '' : 'none';
    if (windWrap) windWrap.style.display = this.getConfig('showWind', true) ? '' : 'none';
    if (forecast) forecast.style.display = this.getConfig('showForecast', true) ? '' : 'none';
  }

  async update() {
    this._applyConfig();
    let d;
    try { d = await (await fetch(this.apiUrl)).json(); } catch(e) { return; }
    const unit = this.getConfig('tempUnit', 'C');
    const icon = this.element.querySelector('#w-icon');
    if(icon) icon.textContent = d.icon || '🌡️';
    const temp = this.element.querySelector('#w-temp');
    const tempVal = d.temp !== undefined ? Math.round(d.temp) : '--';
    if(temp) temp.textContent = unit === 'F' ? this.toF(d.temp) + '°F' : tempVal + '°';
    const city = this.element.querySelector('#w-city');
    if(city) city.textContent = d.city || 'Unknown';
    const h3 = this.element.querySelector('.weather-city');
    if(h3 && this.getConfig('city', 'auto') !== 'auto') h3.textContent = this.getConfig('city', 'auto');
    const hum = this.element.querySelector('#w-hum');
    if(hum) hum.textContent = (d.humidity !== undefined ? d.humidity : '--') + '%';
    const wind = this.element.querySelector('#w-wind');
    if(wind) wind.textContent = d.wind !== undefined ? d.wind : '--';
    const forecast = this.element.querySelector('#w-forecast');
    if(forecast && d.forecast) {
      const min = unit === 'F' ? this.toF(d.forecast.min) : Math.round(d.forecast.min);
      const max = unit === 'F' ? this.toF(d.forecast.max) : Math.round(d.forecast.max);
      const su = unit === 'F' ? '°F' : '°';
      forecast.textContent = '↓' + min + su + ' ↑' + max + su;
    }
  }
}
window.WeatherWidget = WeatherWidget;
