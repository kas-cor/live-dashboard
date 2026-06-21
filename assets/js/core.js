class BaseWidget {
  constructor(id, options = {}) {
    this.id = id;
    this.options = options;
    this.element = null;
    this.interval = null;
    this.size = options.size || 'medium';
    this.config = null;
    this._defaultConfig = {};
    this._configSchema = [];
    this._settingsPanel = null;
  }

  render() { throw new Error('render() must be implemented'); }
  update() { throw new Error('update() must be implemented'); }

  async loadConfig() {
    try {
      const res = await fetch('/api/config/' + this.id, { cache: 'no-store' });
      if (res.ok) {
        const data = await res.json();
        if (data && Object.keys(data).length > 0) {
          this.config = { ...this._defaultConfig, ...data };
          this._saveConfigLocal();
          return;
        }
      }
    } catch(e) {}
    const local = localStorage.getItem('dashboard-config-' + this.id);
    if (local) {
      try { this.config = { ...this._defaultConfig, ...JSON.parse(local) }; } catch(e) { this.config = { ...this._defaultConfig }; }
    } else {
      this.config = { ...this._defaultConfig };
    }
  }

  async saveConfig() {
    this._saveConfigLocal();
    try {
      await fetch('/api/config/' + this.id, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ config: this.config })
      });
    } catch(e) {}
  }

  _saveConfigLocal() {
    localStorage.setItem('dashboard-config-' + this.id, JSON.stringify(this.config));
  }

  getConfig(key, defaultValue) {
    if (this.config && this.config[key] !== undefined) return this.config[key];
    if (this._defaultConfig[key] !== undefined) return this._defaultConfig[key];
    return defaultValue;
  }

  async setConfig(key, value) {
    if (!this.config) this.config = { ...this._defaultConfig };
    this.config[key] = value;
    await this.saveConfig();
  }

  mount(container) {
    this.element = document.createElement('div');
    this.element.className = 'widget widget-' + this.size;
    this.element.id = 'widget-' + this.id;
    this.element.style.gridColumn = '';
    this.render();
    container.appendChild(this.element);
    this.loadConfig().then(() => {
      this.applyLayout();
      this.start();
    });
  }

  applyLayout() {
    if (this.element) {
      const colspan = this.getConfig('colspan', 1);
      if (colspan > 1) {
        this.element.style.gridColumn = 'span ' + colspan;
      } else {
        this.element.style.gridColumn = '';
      }
    }
  }

  start() {
    this.update();
    const interval = this.getConfig('interval', this.options.interval);
    if (interval) {
      this.interval = setInterval(() => this.update(), interval);
    }
  }

  destroy() {
    if (this.interval) clearInterval(this.interval);
    if (this.element) this.element.remove();
  }

  // --- Settings Panel ---
  hasSettings() { return this._configSchema.length > 0; }

  toggleSettings() {
    if (this._settingsPanel) {
      this.closeSettings();
      return;
    }
    this.openSettings();
  }

  openSettings() {
    if (!this.hasSettings() || !this.element) return;
    const panel = document.createElement('div');
    panel.className = 'widget-settings';
    let html = '<div class="settings-title">Settings</div>';
    for (const field of this._configSchema) {
      // Section header (non-input field)
      if (field.type === 'section') {
        html += '<div class="settings-section-title">' + field.label + '</div>';
        continue;
      }
      const val = this.getConfig(field.key, field.default);
      html += '<div class="settings-field">';
      html += '<label class="settings-label">' + field.label + '</label>';
      if (field.type === 'select') {
        html += '<select class="settings-input" data-key="' + field.key + '">';
        for (const opt of field.options) {
          const sel = opt.value === val ? ' selected' : '';
          html += '<option value="' + opt.value + '"' + sel + '>' + opt.label + '</option>';
        }
        html += '</select>';
      } else if (field.type === 'number') {
        const min = field.min !== undefined ? ' min="' + field.min + '"' : '';
        const max = field.max !== undefined ? ' max="' + field.max + '"' : '';
        const step = field.step ? ' step="' + field.step + '"' : '';
        html += '<input type="number" class="settings-input" data-key="' + field.key + '" value="' + val + '"' + min + max + step + '>';
      } else if (field.type === 'range') {
        const min = field.min !== undefined ? field.min : 0;
        const max = field.max !== undefined ? field.max : 100;
        html += '<div class="settings-range-row">';
        html += '<input type="range" class="settings-range" data-key="' + field.key + '" value="' + val + '" min="' + min + '" max="' + max + '" step="' + (field.step || 1) + '">';
        html += '<span class="settings-range-val">' + val + '</span>';
        html += '</div>';
      } else if (field.type === 'checkbox') {
        html += '<input type="checkbox" class="settings-input" data-key="' + field.key + '"' + (val ? ' checked' : '') + '>';
      } else {
        html += '<input type="text" class="settings-input" data-key="' + field.key + '" value="' + (val || '') + '">';
      }
      html += '</div>';
    }
    html += '<div class="settings-actions">';
    html += '<button class="settings-save">Save</button>';
    html += '<button class="settings-cancel">Cancel</button>';
    html += '</div>';
    panel.innerHTML = html;

    // Range slider live preview
    panel.querySelectorAll('.settings-range').forEach(slider => {
      const valSpan = slider.parentElement.querySelector('.settings-range-val');
      slider.addEventListener('input', () => {
        if (valSpan) valSpan.textContent = slider.value;
      });
    });

    this.element.appendChild(panel);
    this._settingsPanel = panel;

    panel.querySelector('.settings-save').addEventListener('click', async () => {
      const inputs = panel.querySelectorAll('.settings-input, .settings-range');
      for (const input of inputs) {
        const key = input.dataset.key;
        let value;
        if (input.type === 'checkbox') value = input.checked;
        else if (input.type === 'number') value = parseFloat(input.value);
        else if (input.type === 'range') value = parseInt(input.value);
        else value = input.value;
        await this.setConfig(key, value);
      }
      this.closeSettings();
      this.applyLayout();
      if (this.interval) clearInterval(this.interval);
      this.start();
    });
    panel.querySelector('.settings-cancel').addEventListener('click', () => this.closeSettings());
  }

  closeSettings() {
    if (this._settingsPanel) {
      this._settingsPanel.remove();
      this._settingsPanel = null;
    }
  }
}

// --- Alert Manager (singleton) ---
class AlertManager {
  constructor() {
    this._cooldownMs = 10 * 60 * 1000;
    this._active = false;
    this._overlay = null;
    this._modal = null;
    this._audioCtx = null;
    this._sirenNode = null;
    this._pulseAnim = null;
    this._tabFlashTimer = null;
    this._origTitle = '';
    this._currentAlert = null;
    this._notifyPermitted = false;
    // Per-alert cooldown: key = "widgetId|metric" → timestamp (persisted to localStorage)
    this._cooldowns = new Map();
    // Siren resume promise (prevents mid-siren resume spam)
    this._resumePromise = null;
  }

  start() {
    this._loadCooldowns();

    // Request notification permission early
    this._requestNotifyPermission();

    // Save original page title
    this._origTitle = document.title;

    // Pre-create AudioContext (will be suspended until user gesture)
    this._initAudio();

    // Sound status indicator (shows until first user interaction unlocks audio)
    this._addSoundIndicator();

    // Create overlay
    this._overlay = document.createElement('div');
    this._overlay.className = 'alert-overlay';
    this._overlay.style.display = 'none';
    this._overlay.innerHTML = '<div class="alert-container"><div class="alert-modal"><div class="alert-icon">\u26A0</div><div class="alert-title">WARNING</div><div class="alert-body"></div><button class="alert-dismiss">\u041F\u043E\u043D\u044F\u043B, \u043F\u0440\u0438\u043D\u044F\u043B</button></div></div>';
    document.body.appendChild(this._overlay);

    this._modal = this._overlay.querySelector('.alert-modal');
    this._overlay.querySelector('.alert-dismiss').addEventListener('click', () => this.dismiss());

    // First-user-gesture listener: unlock audio + notifications
    const unlockHandler = async () => {
      this._ensureAudio();
      await this._ensureNotifyPermission();
    };
    document.addEventListener('click', unlockHandler, { once: true });
    document.addEventListener('keydown', unlockHandler, { once: true });
    document.addEventListener('touchstart', unlockHandler, { once: true });
  }

  // --- Dismiss without recording cooldown (for switching alerts) ---
  _dismissSilent() {
    this._active = false;
    this._overlay.style.display = 'none';
    this._stopPulse();
    this._stopSiren();
    this._stopTabFlash();
    this._currentAlert = null;
  }

  // --- Audio (single context, resume on first gesture) ---
  _initAudio() {
    try {
      this._audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      // Browser will suspend it; we resume on first user gesture
    } catch(e) {
      console.warn('[AlertManager] AudioContext not available');
    }
  }

  async _ensureAudio() {
    if (!this._audioCtx) return false;
    if (this._audioCtx.state === 'running') return true;
    if (this._audioCtx.state === 'suspended') {
      try {
        await this._audioCtx.resume();
        this._hideSoundIndicator();
        return true;
      } catch(e) {
        return false;
      }
    }
    return false;
  }

  _addSoundIndicator() {
    if (!this._audioCtx || this._audioCtx.state === 'running') return;
    const el = document.createElement('div');
    el.id = 'sound-indicator';
    el.innerHTML = '🔇 Кликните для звука';
    el.style.cssText = 'position:fixed;bottom:12px;left:12px;z-index:9999;font-size:12px;font-family:Inter,sans-serif;color:var(--text-secondary);background:var(--glass);border:1px solid var(--border);border-radius:8px;padding:6px 12px;backdrop-filter:blur(12px);cursor:pointer;transition:opacity .3s;';
    el.addEventListener('click', () => this._ensureAudio());
    document.body.appendChild(el);
    this._soundIndicator = el;
  }

  _hideSoundIndicator() {
    if (this._soundIndicator) {
      this._soundIndicator.style.opacity = '0';
      setTimeout(() => { if (this._soundIndicator) this._soundIndicator.remove(); }, 300);
      this._soundIndicator = null;
    }
  }

  // --- Cooldown persistence ---
  _loadCooldowns() {
    try {
      const saved = localStorage.getItem('dashboard-alert-cooldowns');
      if (saved) {
        const obj = JSON.parse(saved);
        const now = Date.now();
        for (const [key, ts] of Object.entries(obj)) {
          if (now - ts < this._cooldownMs) {
            this._cooldowns.set(key, ts);
          }
        }
      }
    } catch(e) {}
  }

  _saveCooldowns() {
    try {
      const now = Date.now();
      const obj = {};
      // Only save non-expired cooldowns
      for (const [key, ts] of this._cooldowns) {
        if (now - ts < this._cooldownMs) {
          obj[key] = ts;
        }
      }
      localStorage.setItem('dashboard-alert-cooldowns', JSON.stringify(obj));
    } catch(e) {}
  }

  _requestNotifyPermission() {
    if (!('Notification' in window)) return;
    if (Notification.permission === 'granted') {
      this._notifyPermitted = true;
    } else if (Notification.permission === 'default') {
      // Will request on trigger when needed
    }
  }

  async _ensureNotifyPermission() {
    if (!('Notification' in window)) return;
    if (Notification.permission === 'granted') {
      this._notifyPermitted = true;
      return;
    }
    if (Notification.permission === 'denied') return;
    try {
      const perm = await Notification.requestPermission();
      this._notifyPermitted = (perm === 'granted');
    } catch(e) {
      // Notification API may not be available
    }
  }



  trigger(alert) {
    const now = Date.now();
    const key = (alert.widgetId || 'unknown') + '|' + (alert.metric || 'unknown');

    // If this exact alert is already showing — skip silently
    if (this._active && this._currentAlert &&
        (this._currentAlert.widgetId || 'unknown') + '|' + (this._currentAlert.metric || 'unknown') === key) {
      return;
    }

    // If a different alert is already showing — dismiss it first
    if (this._active) {
      this._dismissSilent();
    }

    // Per-alert cooldown: check if dismissed less than 10 min ago
    const lastDismissed = this._cooldowns.get(key) || 0;
    if (lastDismissed > 0 && (now - lastDismissed) < this._cooldownMs) {
      return;
    }

    // Record cooldown NOW (at trigger time) + persist immediately
    this._cooldowns.set(key, now);
    this._saveCooldowns();

    this._currentAlert = alert;

    const desc = alert.description ||
      alert.widgetTitle + ': ' + alert.metric + ' \u0434\u043E\u0441\u0442\u0438\u0433 ' + alert.value + alert.unit + ' (\u043F\u043E\u0440\u043E\u0433: ' + alert.threshold + alert.unit + ')';

    // Push notification
    this._sendPushNotification(alert.widgetTitle || 'Dashboard Alert', desc);

    // Tab title flashing
    this._startTabFlash();

    // Try to focus the window
    this._focusWindow();

    // Overlay + siren
    this._overlay.querySelector('.alert-body').textContent = desc;
    this._overlay.style.display = 'flex';
    this._active = true;
    this._startPulse();

    // _startSiren now fails silently if AudioContext not yet resumed — that's intentional
    this._startSiren();

    // Webhook is now sent server-side — no need to duplicate from frontend
  }

  async _sendPushNotification(title, body) {
    await this._ensureNotifyPermission();
    if (!this._notifyPermitted || !('Notification' in window)) return;

    try {
      const shortBody = body.length > 180 ? body.substring(0, 177) + '...' : body;

      const notif = new Notification(title, {
        body: shortBody,
        icon: '/assets/img/favicon.svg',
        tag: 'dashboard-alert',
        requireInteraction: true,
        vibrate: [200, 100, 200, 100, 200],
        silent: false
      });

      notif.onclick = () => {
        window.focus();
        notif.close();
      };

      setTimeout(() => { try { notif.close(); } catch(e) {} }, 30000);
    } catch(e) {
      console.warn('Push notification failed:', e);
    }
  }

  _startTabFlash() {
    if (this._tabFlashTimer) return;
    let flash = true;
    this._origTitle = document.title;
    this._tabFlashTimer = setInterval(() => {
      document.title = flash ? '\u26A0 WARNING \u26A0' : this._origTitle;
      flash = !flash;
    }, 800);
  }

  _stopTabFlash() {
    if (this._tabFlashTimer) {
      clearInterval(this._tabFlashTimer);
      this._tabFlashTimer = null;
      document.title = this._origTitle;
    }
  }

  _focusWindow() {
    try {
      window.focus();
      window.scrollTo(0, 0);
    } catch(e) {
      // Browser may block programmatic focus
    }
  }

  dismiss() {
    // Save cooldown timestamp on dismiss (extends the 10-min silence)
    if (this._currentAlert) {
      const key = (this._currentAlert.widgetId || 'unknown') + '|' + (this._currentAlert.metric || 'unknown');
      this._cooldowns.set(key, Date.now());
      this._saveCooldowns();
    }
    this._active = false;
    this._overlay.style.display = 'none';
    this._stopPulse();
    this._stopSiren();
    this._stopTabFlash();
    this._currentAlert = null;
  }

  _startPulse() {
    let frameId;
    let start = performance.now();
    const cycleMs = 1200;

    const animate = (ts) => {
      if (!this._active) return;
      const elapsed = (ts - start) % cycleMs;
      const t = elapsed / cycleMs;
      const opacity = 0.2 + 0.6 * (1 - Math.abs(2 * t - 1));
      this._overlay.style.backgroundColor = 'rgba(180, 0, 0, ' + opacity.toFixed(2) + ')';
      frameId = requestAnimationFrame(animate);
    };
    frameId = requestAnimationFrame(animate);
    this._pulseAnim = frameId;
  }

  _stopPulse() {
    if (this._pulseAnim) {
      cancelAnimationFrame(this._pulseAnim);
      this._pulseAnim = null;
    }
    this._overlay.style.backgroundColor = '';
  }

  async _startSiren() {
    const audioReady = await this._ensureAudio();
    if (!audioReady) {
      console.warn('[AlertManager] audio not ready (needs user gesture first)');
      return;
    }

    try {
      const ctx = this._audioCtx;
      const osc1 = ctx.createOscillator();
      const osc2 = ctx.createOscillator();
      const gain = ctx.createGain();

      osc1.type = 'sawtooth';
      osc2.type = 'square';

      const modFreq = ctx.createOscillator();
      const modGain = ctx.createGain();
      modFreq.type = 'sine';
      modFreq.frequency.value = 0.7;
      modGain.gain.value = 400;
      modFreq.connect(modGain);
      modGain.connect(osc1.frequency);
      modGain.connect(osc2.frequency);

      osc1.frequency.value = 800;
      osc2.frequency.value = 900;

      osc1.connect(gain);
      osc2.connect(gain);
      gain.gain.value = 0.06;
      gain.connect(ctx.destination);

      modFreq.start();
      osc1.start();
      osc2.start();

      this._sirenNode = { osc1, osc2, gain, modFreq };
    } catch(e) {
      console.warn('[AlertManager] siren failed:', e);
    }
  }

  _stopSiren() {
    if (this._sirenNode) {
      try {
        this._sirenNode.osc1.stop();
        this._sirenNode.osc2.stop();
        this._sirenNode.modFreq.stop();
      } catch(e) {}
      this._sirenNode = null;
    }
    if (this._audioCtx) {
      this._audioCtx.close().catch(() => {});
      this._audioCtx = null;
    }
  }
}



class Dashboard {
  constructor(containerId) {
    this.container = document.getElementById(containerId);
    this.widgets = new Map();
    this._dragSrcId = null;
    this._initDragDrop();
  }

  unregister(id) {
    const widget = this.widgets.get(id);
    if (widget) {
      widget.destroy();
      this.widgets.delete(id);
    }
  }

  // --- Drag & Drop ---

  _initDragDrop() {
    // Используем делегирование событий на контейнере
    this.container.addEventListener('dragstart', (e) => this._onDragStart(e));
    this.container.addEventListener('dragover', (e) => this._onDragOver(e));
    this.container.addEventListener('drop', (e) => this._onDrop(e));
    this.container.addEventListener('dragend', (e) => this._onDragEnd(e));
  }

  _makeDraggable() {
    // Делаем заголовки виджетов перетаскиваемыми
    for (const [id, widget] of this.widgets) {
      if (widget.element) {
        const header = widget.element.querySelector('.widget-header');
        if (header) {
          header.draggable = true;
        }
      }
    }
  }

  _onDragStart(e) {
    const headerEl = e.target.closest('.widget-header');
    if (!headerEl) {
      e.preventDefault();
      return;
    }
    const widgetEl = headerEl.closest('.widget');
    if (!widgetEl) return;
    this._dragSrcId = widgetEl.id.replace('widget-', '');
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', this._dragSrcId);

    // Устанавливаем drag image как весь виджет (а не только заголовок)
    const rect = widgetEl.getBoundingClientRect();
    e.dataTransfer.setDragImage(widgetEl, e.clientX - rect.left, e.clientY - rect.top);

    // Добавляем класс для визуального эффекта
    setTimeout(() => widgetEl.classList.add('widget-dragging'), 0);
  }

  _onDragOver(e) {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';

    // Убираем все индикаторы со всех виджетов
    this.container.querySelectorAll('.widget-drop-before, .widget-drop-after').forEach(el => {
      el.classList.remove('widget-drop-before', 'widget-drop-after');
    });

    const widgetEl = e.target.closest('.widget');
    if (!widgetEl) return;
    const targetId = widgetEl.id.replace('widget-', '');
    if (targetId === this._dragSrcId) return;

    // Определяем, куда вставить: выше или ниже середины
    const rect = widgetEl.getBoundingClientRect();
    const midY = rect.top + rect.height / 2;
    if (e.clientY < midY) {
      widgetEl.classList.add('widget-drop-before');
    } else {
      widgetEl.classList.add('widget-drop-after');
    }
  }

  _onDrop(e) {
    e.preventDefault();
    // Убираем все индикаторы
    this.container.querySelectorAll('.widget-drop-before, .widget-drop-after').forEach(el => {
      el.classList.remove('widget-drop-before', 'widget-drop-after');
    });

    const widgetEl = e.target.closest('.widget');
    if (!widgetEl || !this._dragSrcId) return;

    const targetId = widgetEl.id.replace('widget-', '');
    if (targetId === this._dragSrcId) return;

    const srcWidget = this.widgets.get(this._dragSrcId);
    const targetWidget = this.widgets.get(targetId);
    if (!srcWidget || !targetWidget || !srcWidget.element || !targetWidget.element) return;

    const srcEl = srcWidget.element;
    const tgtEl = targetWidget.element;

    // Меняем местами: определяем, кто из них раньше в DOM
    const srcIndex = Array.prototype.indexOf.call(this.container.children, srcEl);
    const tgtIndex = Array.prototype.indexOf.call(this.container.children, tgtEl);

    if (srcIndex < tgtIndex) {
      // src выше — вставляем tgt перед src (src уходит вниз)
      this.container.insertBefore(tgtEl, srcEl);
    } else {
      // tgt выше — вставляем src перед tgt (tgt уходит вниз)
      this.container.insertBefore(srcEl, tgtEl);
    }

    // Сохраняем порядок
    this._saveOrder();
  }

  _onDragEnd(e) {
    this.container.querySelectorAll('.widget-dragging, .widget-drop-before, .widget-drop-after').forEach(el => {
      el.classList.remove('widget-dragging', 'widget-drop-before', 'widget-drop-after');
    });
    this._dragSrcId = null;
  }

  _saveOrder() {
    const order = [];
    const children = this.container.children;
    for (let i = 0; i < children.length; i++) {
      const el = children[i];
      if (el.classList.contains('widget')) {
        const id = el.id.replace('widget-', '');
        order.push(id);
      }
    }
    try {
      localStorage.setItem('dashboard-widget-order', JSON.stringify(order));
    } catch(e) {}
  }

  _restoreOrder() {
    try {
      const saved = localStorage.getItem('dashboard-widget-order');
      if (!saved) return;
      const order = JSON.parse(saved);
      if (!Array.isArray(order) || order.length === 0) return;

      // Собираем элементы в нужном порядке
      const fragment = document.createDocumentFragment();
      for (const id of order) {
        const widget = this.widgets.get(id);
        if (widget && widget.element && widget.element.parentNode === this.container) {
          fragment.appendChild(widget.element);
        }
      }
      // Добавляем оставшиеся (новые) виджеты в конец
      const remaining = [];
      const children = this.container.children;
      for (let i = 0; i < children.length; i++) {
        const el = children[i];
        if (el.classList.contains('widget') && !fragment.contains(el)) {
          remaining.push(el);
        }
      }
      for (const el of remaining) {
        fragment.appendChild(el);
      }
      if (fragment.children.length > 0) {
        this.container.appendChild(fragment);
      }
    } catch(e) {}
  }

  // Переопределяем register, чтобы после монтирования восстановить порядок
  // и сделать виджеты перетаскиваемыми
  register(widget) {
    if (this.widgets.has(widget.id)) {
      console.warn('Widget "' + widget.id + '" already registered');
      return;
    }
    this.widgets.set(widget.id, widget);
    widget.mount(this.container);

    // После монтирования всех виджетов восстанавливаем порядок
    // Используем requestAnimationFrame, чтобы дать браузеру отрисовать
    if (this.widgets.size === 1) {
      // Первый виджет — отложим восстановление
      requestAnimationFrame(() => {
        this._restoreOrder();
        this._makeDraggable();
      });
    } else {
      this._makeDraggable();
    }
  }
}

window.Dashboard = Dashboard;
window.BaseWidget = BaseWidget;
window.AlertManager = AlertManager;
