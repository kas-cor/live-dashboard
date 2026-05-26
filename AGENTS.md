# Live Dashboard — Agent Documentation

## Project Overview

A modular dashboard for a second monitor with a cyberpunk theme. The backend (Python FastAPI) collects system metrics, monitors remote servers via SSH, tracks Docker containers, Tailscale peers, and website uptime. It features a **background alert engine** that sends webhook notifications when configured thresholds are exceeded.

---

## Architecture

```
┌─────────────────────────────────────────────────┐
│  Docker Compose                                  │
│  ┌──────────────┐       ┌─────────────────────┐  │
│  │  Frontend    │       │  Backend (FastAPI)  │  │
│  │  nginx       │◄─────►│  Port 9090          │  │
│  │  Port 3003   │       │  + 16 API endpoints │  │
│  └──────────────┘       └────────┬────────────┘  │
│                                  │                │
│                    ┌─────────────┼──────────────┐ │
│                    ▼             ▼              ▼ │
│               System Info   Docker/Tailscale  SSH │
│               Weather/Crypto Server/Sites/Logs   │
└──────────────────────────────────────────────────┘
                        │
              Alert Webhook (threshold check)
                        ▼
                 AI Agent
```

## Alert Webhook System

The alert engine runs as a background asyncio loop inside the FastAPI process (interval: `ALERT_CHECK_INTERVAL`, default 60s).

### How It Works
1. Checks local system (sysinfo), remote servers (server-status), Docker (docker), and Sites (site-status)
2. Compares metrics against configurable thresholds (default: 90% for CPU/RAM/Disk)
3. Respects cooldown timers (`ALERT_COOLDOWN_MINUTES`, default: 10)
4. Sends HTTP POST with JSON payload to `ALERT_WEBHOOK_URL`

### Webhook Payload
```json
{
  "messages": [{
    "type": "alert",
    "timestamp": "2026-05-26T22:30:00Z",
    "widget_id": "sysload",
    "widget_title": "System Load (server-name)",
    "metric": "CPU",
    "value": 95.0,
    "threshold": 90.0,
    "unit": "%",
    "description": "System Load (server-name): CPU reached 95% (threshold: 90%). Exceeded by 5%."
  }]
}
```

### Alert Sources

| Source | Widget ID | Metrics |
|--------|-----------|---------|
| Local system | `sysload` | CPU, RAM, Disk |
| Remote server | `{server_id}` | CPU, RAM, Disk, Online/Offline |
| Docker | `docker` | Stopped containers count |
| Websites | `sites` | HTTP status |

### Manual Alert from AI Agent
```bash
curl -X POST 'http://localhost:9090/api/alert' \
  -H 'Content-Type: application/json' \
  -d '{"messages": [{"type":"alert","widget_id":"custom","widget_title":"CI Pipeline","metric":"Build","value":1,"threshold":0,"unit":"","description":"Build #1423 failed"}]}'
```

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/sysinfo` | CPU, RAM, Disk, uptime, load, alerts |
| GET | `/api/docker` | Docker containers + alerts |
| GET | `/api/tailscale` | Tailscale peers |
| GET | `/api/server-status` | Remote SSH servers |
| GET | `/api/site-status` | Website HTTP checks |
| GET | `/api/todo` | Task list |
| GET | `/api/weather` | Open-Meteo weather |
| GET | `/api/crypto` | CoinGecko prices |
| GET | `/api/logs` | Systemd journal |
| GET | `/api/config/{id}` | Widget config |
| GET | `/api/config` | All configs |
| GET | `/api/alert-config` | Webhook config |
| PUT | `/api/config/{id}` | Save config |
| DELETE | `/api/config/{id}` | Delete config |
| POST | `/api/alert` | Trigger custom alert |

## Threshold Config via API
```bash
curl -X PUT 'http://localhost:9090/api/config/sysload' \
  -H 'Content-Type: application/json' \
  -d '{"config": {"alertCpuEnabled": true, "alertCpuThreshold": 80}}'
```

## Widget System

```
assets/
├── js/core.js            — Dashboard + BaseWidget
├── js/widgets/*.js       — Plugin widgets
├── css/dashboard.css     — Cyberpunk theme
└── img/favicon.svg
```

### BaseWidget API
```javascript
constructor(id, options)   // options.size: small|medium|large, options.interval
render()                   // One-time: populate this.element.innerHTML
async update()             // Each interval: fetch data, update DOM
start(interval)            // Start periodic updates
stop()                     // Stop updates
setError(msg)              // Show error (isolated per widget)
```

### Adding a Widget
```javascript
class MyWidget extends BaseWidget {
  constructor(id, options) { super(id, options); this.size = 'medium'; }
  render() { this.element.innerHTML = `<div class="widget-body">...</div>`; }
  async update() { /* fetch this.apiUrl, update DOM */ }
}
window.MyWidget = MyWidget;
```

## Docker Compose Config

### Volumes
- `/var/run/docker.sock` — Docker API
- `/proc:/host/proc` — Host process
- `/sys:/host/sys` — Host system
- `/var/log:/host/log` — Journal
- `TODO_HOST_PATH:/host/todo` — Tasks
- `~/.ssh:/root/.ssh` — SSH keys
- `dashboard-data:/data` — SQLite DB

### Env Vars
```
BACKEND_PORT=9090
BACKEND_HOST=127.0.0.1
BACKEND_HOSTNAME=hostname
SERVERS_CONFIG={"id":{"name":"Name","host":"ip","port":22,"user":"root"}}
SITES_SEED=https://site1.com,https://site2.com
TODO_PATH=/host/todo/tasks.json
ALERT_WEBHOOK_URL=https://agent/webhook
ALERT_WEBHOOK_AUTH_TOKEN=token
ALERT_CHECK_INTERVAL=60
ALERT_COOLDOWN_MINUTES=10
```

## Build
```bash
./rebuild.sh              # Full rebuild
make rebuild              # Same
make up / down / logs     # Container management
```