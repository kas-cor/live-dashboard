# Parsec save tokens — Dashboard Integration

Live savings of the local parsec proxy. The widget is read-only: it consumes
`~/.parsec/ledger.jsonl` (mounted read-only into the container) through the
FastAPI backend. Ports 8082/8084/8090/8091 of the proxy are never touched.

## Backend endpoint (`backend.py`)

```python
PARSEC_SCRIPTS = os.environ.get("PARSEC_SCRIPTS", "/app/parsec-scripts")
PARSEC_LEDGER = os.environ.get("PARSEC_LEDGER", "/parsec-data/ledger.jsonl")
PARSEC_PRICES = os.environ.get("PARSEC_PRICES", os.path.join(PARSEC_SCRIPTS, "ollama_prices.json"))
PARSEC_CACHE_TTL = float(os.environ.get("PARSEC_CACHE_TTL", "5"))

@app.get("/api/parsec-save")
def parsec_save(window: str = "", refresh: int = 0):
    ...
```

`parsec_savings.py` is loaded by path (`importlib.util.spec_from_file_location`),
so no package install and no `sys.path` fiddling. Result is cached for
`PARSEC_CACHE_TTL` seconds; `?refresh=1` bypasses it. Failures return
`{"error": ..., "windows": {}}` with HTTP 200 (same contract as the
ollama-usage endpoint) and are logged as warnings.

### JSON shape

```json
{
  "generated_at": "2026-09-22T09:52:11Z",
  "ledger": {"path": "/parsec-data/ledger.jsonl", "rows": 2679, "unparsable": 0,
             "unmeasured_total": 2014,
             "first_ts": "2026-09-19T15:01:08Z", "last_ts": "2026-09-22T09:52:02Z"},
  "prices": {"source": "https://ollama.com/pricing", "unit": "usd_per_1m_tokens",
             "peak_window_utc": "12:00-18:00 Mon-Fri"},
  "cache_ttl": 5.0,
  "windows": {
    "24h": {
      "hours": 24, "since": "2026-09-21T09:52:02Z",
      "requests": 2679, "measured_requests": 667, "unmeasured_requests": 2012,
      "peak_requests": 0,
      "tokens_saved": 11980000, "counterfactual_in": 74100000,
      "usd_saved": 1.8, "usd_cost": 2.8,
      "billed_in": 7410000, "cache_read": 265000000, "cache_write": 0, "output": 1440000,
      "saved_pct_of_counterfactual": 16.1, "usd_saved_share_pct": 39.1,
      "unpriced_models": [],
      "models": [{"model": "deepseek-v4.1-flash", "requests": 2678, "tokens_saved": 11980000,
                  "usd_saved": 1.8, "usd_cost": 2.8, "cache_read": 265000000, "output": 1440000,
                  "priced": true, "...": "same keys as the totals"}]
    },
    "7d": {"hours": 168, "...": "..."},
    "all": {"hours": 0, "since": null, "...": "..."}
  }
}
```

`?window=24h` adds `selected` and `selected_totals` (the totals of that window
flattened) so curl/`jq` one-liners stay short. `?window=99h` → `error:
unknown_window` + `available_windows`.

## Docker

```yaml
# docker-compose.yml
    volumes:
      - ${HOME}/.parsec:/parsec-data:ro
    environment:
      - PARSEC_LEDGER=/parsec-data/ledger.jsonl
      - PARSEC_SCRIPTS=/app/parsec-scripts
```

```dockerfile
# Dockerfile
COPY backend/parsec-save/scripts/ /app/parsec-scripts/
```

## index.html registration

```html
<script src="assets/js/widgets/parsec-save.js?v=__CACHEBUSTER__"></script>

dashboard.register(new ParsecSaveWidget('parsec-save', {
  size: 'medium',
  interval: 30000,
  apiUrl: API + '/api/parsec-save',
  title: '💸 Parsec save',
}));
```

## Widget behaviour

* `render()` — header (title + 24ч/7д/всё buttons + `last-update`) and body
  (hero numbers, 6 metric cells, model list, footer).
* `update()` — one `fetch` per interval (30 s) returning **all three windows**;
  the buttons only re-paint from the cached payload, so switching windows is
  instant and costs no request. `last-update` shows `generated_at`, its tooltip
  shows ledger rows / unmeasured rows.
* Numbers: `k/M/B` for tokens, `$X.XX` for money, `ru-RU` grouping for counts.
  «Запросы» carries a sub-line «N без замера» whenever the window contains rows
  without a counterfactual (they are excluded from savings).
* On API failure the widget calls `setError('parsec-save: …')`; a missing ledger
  renders `нет ledger: /parsec-data/ledger.jsonl`.

## CSS (dashboard.css)

`.parsec-windows`, `.parsec-window-btn(.is-active)`, `.parsec-body`, `.parsec-hero*`,
`.parsec-metrics` (3-col grid), `.parsec-metric(-label/-value/-sub)`,
`.parsec-usd-saved/-cost`, `.parsec-foot`. Model bars reuse the existing
`.models-list/.model-row/.model-bar-*` classes from the Ollama widget.
