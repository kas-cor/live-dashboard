# Ollama Cloud Usage — Dashboard Integration

## Backend endpoint (`backend.py`)

```python
# --- Ollama Cloud Usage ---
OLLAMA_USAGE_FILE = os.environ.get("OLLAMA_USAGE_FILE", "/ollama-data/ollama-usage.json")

@app.get("/api/ollama-usage")
def ollama_usage():
    """Возвращает данные об использовании Ollama Cloud из JSON-файла."""
    try:
        with open(OLLAMA_USAGE_FILE) as f:
            data = json.load(f)
    except (FileNotFoundError, json.JSONDecodeError):
        return {"error": "no_data", "plan": "unknown",
                "session": {"percent": 0, "resets_at": None, "models": []},
                "weekly": {"percent": 0, "resets_at": None, "models": []},
                "fetched_at": None}

    # Server-side alert check
    config = get_widget_config_dict("ollama-usage")
    alerts = []

    session_pct = data.get("session", {}).get("percent", 0)
    session_threshold = config.get("alertSessionThreshold", 80)
    session_enabled = config.get("alertSessionEnabled", True)
    alert = alert_service.check_metric(
        "Ollama Cloud", "ollama-usage", "ollama.com",
        "Session usage", session_pct, session_threshold, session_enabled
    )
    if alert:
        alerts.append(alert)

    weekly_pct = data.get("weekly", {}).get("percent", 0)
    weekly_threshold = config.get("alertWeeklyThreshold", 80)
    weekly_enabled = config.get("alertWeeklyEnabled", True)
    alert = alert_service.check_metric(
        "Ollama Cloud", "ollama-usage", "ollama.com",
        "Weekly usage", weekly_pct, weekly_threshold, weekly_enabled
    )
    if alert:
        alerts.append(alert)

    pending = alert_service.pending_alerts("ollama-usage", "ollama.com", "Ollama Cloud", {
        "Session usage": session_pct,
        "Weekly usage": weekly_pct,
    }, config)

    data["alerts"] = pending

    if alerts:
        try:
            loop = asyncio.get_event_loop()
            loop.create_task(alert_service.send_webhook(alerts))
        except RuntimeError:
            pass

    return data
```

## Docker volume mount (`docker-compose.yml`)

```yaml
volumes:
  - /projects/dashboard/data:/ollama-data:ro
```

## index.html registration

```html
<script src="assets/js/widgets/ollama-usage.js?v=__CACHEBUSTER__"></script>

<!-- Registration -->
dashboard.register(new OllamaUsageWidget('ollama-usage', {
  size: 'medium',
  interval: 30000,
  apiUrl: API + '/api/ollama-usage',
  title: '☁️ Ollama Cloud',
}));
```

## CSS (dashboard.css)

```css
/* ── Ollama Cloud Usage Widget ────────────────── */
.ollama-card { padding: 8px 0; }
.ollama-plan-line { font-size: 13px; font-weight: 600; margin-bottom: 12px; display: flex; align-items: center; gap: 6px; }
.ollama-metrics { display: flex; flex-direction: column; gap: 8px; margin-bottom: 8px; }
.ollama-resets { display: flex; justify-content: space-between; font-size: 11px; color: var(--text-secondary); margin-bottom: 10px; padding: 4px 0; border-bottom: 1px solid var(--border); }
.models-header { font-size: 11px; font-weight: 600; color: var(--text-secondary); text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 4px; }
.models-list { display: flex; flex-direction: column; gap: 3px; }
.model-row { display: flex; align-items: center; gap: 6px; font-size: 11px; }
.model-name { flex: 0 0 auto; max-width: 120px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--text-primary); }
.model-bar-track { flex: 1; height: 4px; background: rgba(255,255,255,0.08); border-radius: 2px; overflow: hidden; }
.model-bar-fill { height: 100%; background: var(--accent); border-radius: 2px; transition: width 0.5s ease; }
.model-reqs { flex: 0 0 40px; text-align: right; color: var(--text-secondary); font-family: 'JetBrains Mono', monospace; font-size: 10px; }
```
