# Live Dashboard

[![License](https://img.shields.io/github/license/kas-cor/live-dashboard)](LICENSE)
[![GitHub](https://img.shields.io/badge/GitHub-kas--cor/live-dashboard-181717?logo=github)](https://github.com/kas-cor/live-dashboard)

> 🌐 [Русская версия](README_ru.md)

A **modular dashboard for a second monitor** with a cyberpunk theme. Features 10+ real-time widgets, FastAPI backend, Docker Compose deployment, and an **alert webhook system** that sends threshold-based notifications to AI agents.

## Features

- 🕐 **10+ widgets** — Clock, Weather, Crypto, Network, System Load, Server Status, Sites, TODO, Docker, Tailscale, Logs
- 🤖 **Alert webhook** — automatic notifications when CPU/RAM/disk exceed thresholds, servers go offline, containers stop, sites become unreachable
- 🖥️ **Remote server monitoring** — SSH-based metrics collection for any number of servers
- 🐳 **Docker Compose** — one-command deployment
- 🌗 **Cyberpunk theme** — dark, neon-cyber aesthetic for the second monitor
- 📦 **Plugin widgets** — easy to add new widgets via `BaseWidget` class

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

## Adding a Widget

```javascript
class MyWidget extends BaseWidget {
  constructor(id, options) { super(id, options); this.size = 'medium'; }
  render() { this.element.innerHTML = `<div>...</div>`; }
  async update() { /* fetch and update */ }
}
window.MyWidget = MyWidget;
```

---

<p align="center">
  <a href="README_ru.md">🌐 Русская версия</a>
  &nbsp;·&nbsp;
  <a href="https://github.com/kas-cor/live-dashboard/issues">🐛 Report a Bug</a>
</p>