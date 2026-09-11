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
                "usage": {"percent": 0, "resets_at": None, "models": []},
                "fetched_at": None}

    return data
```

Endpoint просто отдаёт содержимое `data/ollama-usage.json` (монтируется как
`/ollama-data`). Серверных alert-проверок для этого виджета сейчас нет.

### JSON-схема (новая модель Ollama — единый месячный Included usage)

```json
{
  "plan": "pro",
  "usage": {
    "percent": 2.3,
    "used": 1.39,
    "limit": 60.0,
    "currency": "$",
    "resets_at": "2026-10-10T19:49:02Z",
    "models": [
      { "model": "glm-5.3-flash", "requests": 224, "percent": 100.0 }
    ]
  },
  "fetched_at": "2026-09-11T06:59:51Z"
}
```

`used` / `limit` / `currency` заполняются только на платных тарифах
(разметка `$X of $Y`); на free там `null`. Подробнее — `backend/ollama-usage/SKILL.md`.

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
