# Live Dashboard

[![License](https://img.shields.io/github/license/kas-cor/live-dashboard)](LICENSE)
[![GitHub](https://img.shields.io/badge/GitHub-kas--cor/live-dashboard-181717?logo=github)](https://github.com/kas-cor/live-dashboard)

> 🌐 [Русская версия](README_ru.md)

A **modular dashboard for a second monitor** with a cyberpunk theme. Features 10+ real-time widgets, FastAPI backend, Docker Compose deployment, and an **alert webhook system** that sends threshold-based notifications to AI agents.

## Features

- 🕐 **10+ widgets** — Clock, Weather, Crypto, Network, System Load, Server Status, Sites, TODO, Docker, Tailscale, Logs, Ollama Cloud
- 🤖 **Alert webhook** — automatic notifications when CPU/RAM/disk exceed thresholds, servers go offline, containers stop, sites become unreachable
- 🖥️ **Remote server monitoring** — SSH-based metrics collection for any number of servers
- 🐳 **Docker Compose** — one-command deployment
- 🌗 **Cyberpunk theme** — dark, neon-cyber aesthetic for the second monitor
- 📦 **Plugin widgets** — easy to add new widgets via `BaseWidget` class
- 🖱️ **Drag & Drop** — reorder widgets by dragging, order persists in localStorage

## Quick Start

```bash
git clone https://github.com/kas-cor/live-dashboard.git
cd live-dashboard
cp .env.sample .env
# Edit .env with your settings
docker compose up -d
# Open http://localhost:3003
```

## Built-in Widgets

| Widget | Refresh | Source | Description |
|--------|---------|--------|-------------|
| Clock | 1s | Local | Time display |
| Weather | 5min | Open-Meteo API | Temperature, humidity, wind, forecast |
| Crypto | 1min | CoinGecko API | BTC/ETH/XMR prices + 24h change |
| Network | 2s | HTTP HEAD | Online status check |
| System Load | 3s | FastAPI | CPU, RAM, Disk, uptime, load |
| **Ollama Cloud** | **30s** | **FastAPI** | **Session/weekly usage, top models, subscription** |
| Server Status | 15s | SSH | Remote server metrics |
| Sites | 1min | HTTP GET | Website uptime monitoring |
| TODO | 30s | JSON file | Task list |
| Docker | 10s | Docker socket | Container statuses |
| Tailscale | 15s | Tailscale CLI | Network peers |
| Logs | 5s | journalctl | System logs (scrollable) |

## Alert Webhook for AI Agents

The backend runs a background alert loop that checks system metrics and sends webhooks when thresholds are exceeded:

- **CPU > 90%**, RAM > 90%, Disk > 90%
- **Docker containers stopped**
- **Remote servers offline**
- **Monitored websites unreachable**

Configure in `.env`:
```bash
ALERT_WEBHOOK_URL=https://your-agent-endpoint/webhook
ALERT_WEBHOOK_AUTH_TOKEN=your-token
ALERT_COOLDOWN_MINUTES=10
```

## Management

```bash
make rebuild        # Full rebuild + restart
make up             # Start containers
make down           # Stop containers
make logs           # All logs
make status         # Container status
```

## Architecture

```
/
├── assets/
│   ├── css/dashboard.css     — theme
│   ├── js/
│   │   ├── core.js           — Dashboard + BaseWidget
│   │   └── widgets/          — widget plugins
│   └── img/                  — icons, favicon
├── backend/
│   ├── backend.py             — FastAPI with 12 endpoints
│   └── ollama-usage/         — Ollama Cloud parser module (see backend/ollama-usage/SKILL.md)
│       ├── SKILL.md
│       ├── scripts/
│       └── references/
├── data/                     — JSON files for widgets (written externally)
│   └── ollama-usage.json     — Ollama Cloud usage data
├── index.html                — dashboard entry point
├── docker-compose.yml        — orchestration
├── Dockerfile                — unified image (nginx + Python)
├── nginx.conf                — nginx config (proxies /api/* → backend)
├── entrypoint.sh             — container entrypoint
└── data/                     — JSON files for widgets (written externally)
    └── ollama-usage.json     — Ollama Cloud usage data
```

## Adding a Widget

1. Create `assets/js/widgets/mywidget.js`:

```javascript
class MyWidget extends BaseWidget {
  constructor(id, options) { super(id, options); this.size = 'medium'; }
  render() { this.element.innerHTML = `<div>...</div>`; }
  async update() { /* fetch and update */ }
}
window.MyWidget = MyWidget;
```

2. Add `<script>` tag in `index.html`.
3. Register: `dashboard.register(new MyWidget('id', { interval: 5000 }))`.

The system automatically calls `render()` → `update()` → `start(interval)`. Errors in one widget don't break others.

## Ollama Cloud Usage Module

Located at `backend/ollama-usage/` — see `backend/ollama-usage/SKILL.md` for full setup instructions.

**What it does:**
- Parses `ollama.com/settings` and `ollama.com/settings/billing` via session cookie
- Runs every 30 minutes via cron (no_agent mode)
- Writes JSON to `data/ollama-usage.json`
- Backend serves it at `/api/ollama-usage`

**JSON structure:**
```json
{
  "plan": "pro",
  "session": {
    "percent": 24.7,
    "resets_at": "2026-06-21T10:00:00Z",
    "models": [
      { "model": "deepseek-v4-flash", "requests": 685 }
    ]
  },
  "weekly": {
    "percent": 87.0,
    "resets_at": "2026-06-22T00:00:00Z",
    "models": [
      { "model": "deepseek-v4-flash", "requests": 8307 }
    ]
  },
  "subscription": {
    "ends_at": "2026-07-02",
    "ends_at_formatted": "July 2, 2026"
  },
  "fetched_at": "2026-06-21T09:57:49Z"
}
```

**Module contents:**
- `SKILL.md` — module description, setup procedure
- `scripts/ollama-usage.py` — parser script
- `scripts/ollama-usage-dashboard.sh` — cron wrapper
- `references/ollama-usage-widget.js` — dashboard widget
- `references/dashboard-integration.md` — integration guide

---

<p align="center">
  <a href="README_ru.md">🌐 Русская версия</a>
  &nbsp;·&nbsp;
  <a href="https://github.com/kas-cor/live-dashboard/issues">🐛 Report a Bug</a>
</p>
