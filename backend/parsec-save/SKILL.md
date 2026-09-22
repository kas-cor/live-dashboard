---
name: parsec-save-widget
description: Live dashboard widget «Parsec save tokens» — dollarised savings of the parsec proxy from the ledger, 24h/7d/all windows, per-model breakdown
---

# Parsec save tokens — dashboard widget

Live widget showing what the local **parsec proxy** saves: tokens not sent to
Ollama Cloud, that in dollars, the dollars actually spent, plus requests /
cache read / output, a per-model breakdown and a **24ч / 7д / всё** window switch.
It only *reads* the ledger — it never talks to the proxy (ports 8082/8084/8090/8091
stay untouched).

## Pieces

| Piece | Path | Role |
|---|---|---|
| Aggregator | `scripts/parsec_savings.py` | stdlib-only, one pass over `~/.parsec/ledger.jsonl`; computes 24h/7d/all at once (library + CLI) |
| Prices | `scripts/ollama_prices.json` | snapshot of <https://ollama.com/pricing> (standard + peak tables) |
| Price refresher | `scripts/fetch_ollama_prices.py` | re-parse the pricing page into that JSON |
| Tests | `tests/test_parsec_savings.py` | `python3 -m unittest discover -s backend/parsec-save/tests -t backend/parsec-save/tests` |
| API | `backend.py` → `GET /api/parsec-save` | serves all three windows (5 s cache) |
| UI | `assets/js/widgets/parsec-save.js` | plugin widget, 30 s auto-refresh, window switch is client-side |

## Maths (identical to the `parsec-proxy-ops` dollariser)

```
tokens saved = counterfactual_input − (billed_input + cache_read)
cost saved   = tokens saved × input price
cost         = billed_input × input + cache_read × cached_input + billed_output × output
```

* Prices are picked **per request** from that row's UTC timestamp: peak window
  (12:00–18:00 UTC, Mon–Fri) uses the peak table when the model is in it.
* Cache writes are not priced by Ollama → `$0`.
* Rows with `counterfactual_input_tokens: null` (older than the count_tokens
  fix) are counted as `unmeasured_requests` and contribute **nothing** to
  savings — never estimated. The widget shows them under «Запросы».
* A half-written last ledger line is skipped, never fatal.

## API

```bash
curl -s localhost:3003/api/parsec-save | jq '.windows["24h"] | {requests, tokens_saved, usd_saved, usd_cost}'
curl -s 'localhost:3003/api/parsec-save?window=24h&refresh=1' | jq .selected_totals
```

Response: `{generated_at, ledger{path,rows,unmeasured_total,first_ts,last_ts},
prices{source,unit,peak_window_utc}, cache_ttl, windows{24h,7d,all}}`; each window
carries `hours/since/requests/measured_requests/unmeasured_requests/peak_requests/
tokens_saved/counterfactual_in/usd_saved/billed_in/cache_read/cache_write/output/
usd_cost/saved_pct_of_counterfactual/usd_saved_share_pct/unpriced_models/models[]`.
`?window=` also adds `selected` + `selected_totals`; `?refresh=1` bypasses the cache.
Missing ledger/scripts return `{error, detail, windows:{}}` with HTTP 200 — the
dashboard keeps working, the widget shows the reason via `setError`.

## CLI

```bash
python3 backend/parsec-save/scripts/parsec_savings.py --window 24h        # table
python3 backend/parsec-save/scripts/parsec_savings.py --all-windows --json
```

## Wiring (docker)

`docker-compose.yml`: bind `${HOME}/.parsec:/parsec-data:ro`, env
`PARSEC_LEDGER=/parsec-data/ledger.jsonl` + `PARSEC_SCRIPTS=/app/parsec-scripts`.
`Dockerfile`: `COPY backend/parsec-save/scripts/ /app/parsec-scripts/`.
The backend also honours `PARSEC_PRICES` and `PARSEC_CACHE_TTL` (default 5 s).

## Refreshing prices

`python3 scripts/fetch_ollama_prices.py` (writes `ollama_prices.json` next to
itself), then rebuild the image — the JSON is baked in. Rows the page lists as a
range (`$0.60 - $3.60`) are skipped rather than guessed; models without a price
are reported as `unpriced_models` and cost/savings for them stay out of the sums
while their tokens are still counted.

## Relationship to the Telegram report

The 22:00 cron digest (`cron` profile, task `e86d2c4f2e01`) uses the same
formulas via the skill's `parsec_cost.py`; this widget is the live, on-screen
version. Numbers for the same window must match — verify with
`tests/verify_vs_reference.py`.
