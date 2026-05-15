// ── Theme Toggle ───────────────────────────────
// Supports: light / dark / auto (follows system)
// Persists choice in localStorage

(function () {
  const STORAGE_KEY = 'dashboard-theme';

  const modes = [
    { id: 'dark', icon: '🌙', label: 'Тёмная' },
    { id: 'light', icon: '☀️', label: 'Светлая' },
    { id: 'auto', icon: '🔄', label: 'Авто' },
  ];

  function getSavedTheme() {
    try { return localStorage.getItem(STORAGE_KEY); } catch (e) { return 'dark'; }
  }

  function saveTheme(id) {
    try { localStorage.setItem(STORAGE_KEY, id); } catch (e) { /* noop */ }
  }

  function getSystemPrefersLight() {
    return window.matchMedia('(prefers-color-scheme: light)').matches;
  }

  function applyTheme(choice) {
    const root = document.documentElement;

    if (choice === 'auto') {
      const isLight = getSystemPrefersLight();
      root.classList.toggle('light-theme', isLight);
    } else {
      root.classList.toggle('light-theme', choice === 'light');
    }

    // Update active button
    document.querySelectorAll('.theme-btn').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.theme === choice);
    });
  }

  // Watch system changes for auto mode
  window.matchMedia('(prefers-color-scheme: light)').addEventListener('change', () => {
    const saved = getSavedTheme();
    if (saved === 'auto') applyTheme('auto');
  });

  // Build the toggle widget
  function init() {
    const wrapper = document.createElement('div');
    wrapper.className = 'theme-toggle-wrapper';

    modes.forEach(m => {
      const btn = document.createElement('button');
      btn.className = 'theme-btn';
      btn.dataset.theme = m.id;
      btn.innerHTML = `${m.icon}<span class="tooltip">${m.label}</span>`;
      btn.addEventListener('click', () => {
        saveTheme(m.id);
        applyTheme(m.id);
      });
      wrapper.appendChild(btn);
    });

    document.body.appendChild(wrapper);

    // Apply saved theme
    const saved = getSavedTheme() || 'dark';
    applyTheme(saved);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
