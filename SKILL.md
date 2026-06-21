---
name: live-dashboard
description: "Modular dashboard for a second monitor — 10+ widgets (Clock, Weather, Crypto, Server Status, Docker, Tailscale, TODO, Logs, Sites), FastAPI backend, alert webhook integration for AI agents"
version: 1.0.0
author: kas-cor
license: MIT
tags:
  - dashboard
  - monitoring
  - fastapi
  - docker
  - widgets
  - cyberpunk
  - webhook
  - alerts
platforms: [linux]
setup_needed: true
required_commands:
  - docker
  - docker-compose
required_environment_variables:
  - DASHBOARD_PORT
  - BACKEND_PORT
  - ALERT_WEBHOOK_URL
  - ALERT_WEBHOOK_AUTH_TOKEN
---

# Live Dashboard — Server-Side Integration Guide

> **Modular dashboard for a second monitor** with cyberpunk theme, 10+ real-time widgets, and an alert webhook system that sends threshold-based notifications to AI agents.

---

## 📦 Components

| Component | Stack | Purpose |
|-----------|-------|---------|
| **Frontend** | Pure HTML/CSS/JS | Dashboard rendering, widget system, cyberpunk theme |
| **Backend** | Python FastAPI | System data APIs, alert engine, SSH-based server monitoring |
| **Alert Engine** | Background asyncio loop | Checks CPU/RAM/disk thresholds, detects offline servers/containers/sites |
| **Webhook Delivery** | HTTP POST | Sends alerts to any configured webhook URL (e.g., AI agent) |

---

## 🏗 Architecture

```
┌─────────────────────────────────────────────────────┐
│                  Docker Compose                      │
│  ┌─────────────────────┐  ┌──────────────────────┐  │
│  │   Frontend (nginx)  │  │  Backend (FastAPI)   │  │
│  │   Port 3003         │◄─┤  Port 9090           │  │
│  │   10+ JS widgets    │  │  7 API endpoints     │  │
│  └─────────────────────┘  └──────────┬───────────┘  │
│                                      │               │
│                         ┌────────────┼────────────┐  │
│                         ▼            ▼            ▼  │
│                    /api/sysinfo  /api/docker  /api/  │
│                    /api/server-  /api/tailscale  │  │
│                    status        /api/logs       │  │
│                    /api/todo     /api/sites      │  │
│                    /api/weather  /api/crypto     │  │
│                    /api/alert-config             │  │
└──────────────────────┬──────────────────────────────┘
                       │
                       │ Alert Webhook (CPU > 90%, RAM > 90%, offline server, etc.)
                       ▼
              ┌──────────────────┐
              │   AI Agent       │
              │ (OpenClaw,       │
              │  Hermes, etc.)   │
              └──────────────────┘
```

### Data Flow

```
System metrics → Backend APIs → Frontend (real-time updates)
                      │
    Background alert loop (every 60s)
         ↓
    Check thresholds (CPU/RAM/Disk/Offline)
         ↓
    If exceeded → POST to ALERT_WEBHOOK_URL
         ↓
    AI agent receives → can notify, log, or trigger actions
```

---

## 🚀 Quick Start

### Prerequisites
- Docker + Docker Compose
- Git

### 1. Clone & Configure
```bash
git clone https://github.com/kas-cor/live-dashboard.git
cd live-dashboard
cp .env.sample .env
# Edit .env with your settings
```

### 2. Start the Dashboard
```bash
docker compose up -d
# Frontend: http://localhost:3003
# Backend:  http://localhost:9090
```

### 3. Configure Alert Webhook (for AI agent integration)
```bash
# In .env, set your webhook endpoint:
ALERT_WEBHOOK_URL=https://your-ai-agent-endpoint/webhook
ALERT_WEBHOOK_AUTH_TOKEN=your-auth-token
```

### 4. Rebuild After Changes
```bash
docker compose build && docker compose up -d
```

---

## 🤖 AI Agent Integration (Alert Webhook)

### How the Alert System Works

The backend runs a **background asyncio loop** that periodically checks system metrics against configurable thresholds. When a threshold is exceeded, the alert service checks a cooldown timer (default: 10 minutes) and sends a webhook if the alert hasn't been sent recently.

**Monitored conditions:**

| Condition | Default Threshold | Cooldown |
|-----------|------------------|----------|
| CPU usage | > 90% | 10 min |
| RAM usage | > 90% | 10 min |
| Disk usage | > 90% | 10 min |
| Docker container stopped | > 0 stopped | 10 min (resets on change) |
| Server offline | Any | 10 min |
| Site offline | Any | 10 min (resets on change) |

### Webhook Payload Format

```json
{
  "messages": [
    {
      "type": "alert",
      "timestamp": "2026-05-26T22:30:00Z",
      "widget_id": "sysload",
      "widget_title": "System Load (my-server)",
      "metric": "CPU",
      "value": 95,
      "threshold": 90,
      "unit": "%",
      "description": "System Load (my-server): CPU reached 95% (threshold: 90%).\nExceeded by 5%."
    }
  ]
}
```

### Alert Fields

| Field | Description |
|-------|-------------|
| `widget_id` | Which widget/system triggered the alert (`sysload`, `docker`, `sites`, or server ID) |
| `widget_title` | Human-readable source name |
| `metric` | What was measured (`CPU`, `RAM`, `Disk`, `Stopped`, `Offline`) |
| `value` | Current value |
| `threshold` | Configured threshold |
| `unit` | Unit of measurement |
| `description` | Full description |

### Available API Endpoints

| Endpoint | Description |
|----------|-------------|
| `GET /api/sysinfo` | CPU, RAM, Disk, uptime, load, host info + pending alerts |
| `GET /api/docker` | Docker containers list + stopped container alerts |
| `GET /api/tailscale` | Tailscale network status (peers, online/offline) |
| `GET /api/server-status` | SSH-collected metrics from remote servers |
| `GET /api/site-status` | HTTP health checks for monitored websites |
| `GET /api/todo` | TODO list from file |
| `GET /api/weather` | Weather data from Open-Meteo |
| `GET /api/crypto` | Crypto prices from CoinGecko |
| `GET /api/logs` | Systemd journal logs |
| `GET /api/config/{widget_id}` | Widget configuration from SQLite |
| `GET /api/alert-config` | Alert webhook configuration |
| `POST /api/alert` | Manually trigger an alert (useful for agent-driven alerts) |

### Triggering Custom Alerts from an AI Agent

An AI agent can POST to `/api/alert` to push custom alerts through the same webhook pipeline:

```bash
curl -X POST 'http://localhost:9090/api/alert' \
  -H 'Content-Type: application/json' \
  -d '{
    "messages": [{
      "type": "alert",
      "widget_id": "custom",
      "widget_title": "CI Pipeline",
      "metric": "Build Status",
      "value": 1,
      "threshold": 0,
      "unit": "",
      "description": "Deploy failed on production — build #1423"
    }]
  }'
```

### Threshold Configuration

Thresholds per widget are stored in SQLite (`/data/dashboard.db`). Configured via the API:

```bash
# Set CPU alert threshold to 80%
curl -X PUT 'http://localhost:9090/api/config/sysload' \
  -H 'Content-Type: application/json' \
  -d '{"config": {"alertCpuEnabled": true, "alertCpuThreshold": 80}}'

# Get current config
curl 'http://localhost:9090/api/config/sysload'
```

**Available config keys per widget:**

| Widget ID | Config Keys | Defaults |
|-----------|-------------|----------|
| `sysload` | `alertCpuEnabled`, `alertCpuThreshold`, `alertRamEnabled`, `alertRamThreshold`, `alertDiskEnabled`, `alertDiskThreshold` | 90% |
| `docker` | `alertStoppedEnabled`, `alertStoppedThreshold` | 0 |
| `sites` | `alertOfflineEnabled` | true |
| `{server_id}` | `alertCpuEnabled`, `alertCpuThreshold`, `alertRamEnabled`, `alertRamThreshold`, `alertDiskEnabled`, `alertDiskThreshold`, `alertOfflineEnabled` | 90% |

---

## 📊 Widgets Overview

| Widget | Refresh | Data Source | Description |
|--------|---------|-------------|-------------|
| Clock | 1s | Local | Time display |
| Weather | 5min | Open-Meteo API | Temp, humidity, wind, forecast |
| Crypto | 1min | CoinGecko API | BTC/ETH/XMR prices + 24h change |
| Network | 2s | Fetch self HEAD | Online status check |
| System Load | 3s | `/api/sysinfo` | CPU/RAM/Disk, uptime, load avg |
| Server Status | 15s | `/api/server-status` | Remote servers via SSH |
| Sites | 1min | `/api/site-status` | HTTP health check for monitored URLs |
| TODO | 30s | `/api/todo` | Task list from file |
| Docker | 10s | `/api/docker` | Container statuses |
| Tailscale | 15s | `/api/tailscale` | Network peers, online/offline |
| Logs | 5s | `/api/logs` | Systemd journal (scrollable) |

All widgets gracefully fall back to mock data when the backend is unavailable.

---

## 🛠 Management Commands

```bash
docker compose build && docker compose up -d   # Full rebuild + restart
docker compose up -d                           # Start container
docker compose down                            # Stop container
docker compose logs -f                         # All logs
docker compose ps                              # Container status
```

---

## 📁 Repository Structure

```
live-dashboard/
├── SKILL.md              ← This file — AI agent integration guide
├── AGENTS.md             ← Development documentation for agents
├── README.md             ← For humans (EN)
├── README_ru.md          ← For humans (RU)
├── .env.sample           ← Environment template
│
├── backend.py            ← FastAPI backend (alert engine, APIs)
├── index.html            ← Frontend entry point
│
├── assets/
│   ├── css/dashboard.css     ← Cyberpunk theme
│   ├── js/core.js            ← Dashboard + BaseWidget class
│   └── js/widgets/           ← Plugin widgets (clock, weather, etc.)
│
├── Dockerfile              ← Unified image (nginx + Python)
├── docker-compose.yml      ← Service orchestration
├── nginx.conf              ← HTTP nginx config
├── entrypoint.sh           ← Container entrypoint
└── .gitignore
```

---

## 🔧 Adding a New Widget

```javascript
class MyWidget extends BaseWidget {
  constructor(id, options) {
    super(id, options);
    this.size = 'medium'; // small | medium | large
  }
  render() {
    this.element.innerHTML = `
      <div class="widget-header"><h3>Title</h3></div>
      <div class="widget-body">...</div>
    `;
  }
  async update() {
    // Fetch data, update DOM
  }
}
window.MyWidget = MyWidget;
```

Then register in `index.html`:
```javascript
dash.register(new MyWidget('my-id', { interval: 5000 }));
```

The widget system automatically calls `render()` → `update()` → `start(interval)`. Errors are isolated per widget.

---

## ⚠️ Common Pitfalls

- **Docker socket:** backend needs `/var/run/docker.sock` mounted for Docker widget
- **SSH keys:** remote server monitoring requires SSH keys mounted at `~/.ssh`
- **Tailscale:** requires `TS_SOCKET` env var and socket mount
- **TODO path:** configure `TODO_HOST_PATH` in `.env` to mount your todo file
- **Alert cooldown:** default 10 minutes; set `ALERT_COOLDOWN_MINUTES` to override
- **Sites list:** managed via API or `SITES_SEED` env var; no hardcoded URLs in repo