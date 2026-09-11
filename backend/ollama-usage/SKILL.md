---
name: ollama-usage
description: Monitor Ollama Cloud usage (session/weekly limits).
version: 1.2.0
author: Aleksandr
license: MIT
platforms: [linux]
---

# Ollama Cloud Usage — Backend Module

Парсит данные об "Included usage" с `ollama.com/settings` через session cookie и передаёт их в дашборд.

> ⚠️ **2026-09:** Ollama перевела лимиты на новую модель. Вместо старых
> Session/Weekly теперь единый месячный пул **Included usage**
> (процент за период + дата сброса + модели месяца). Поле `subscription`
> и `session`/`weekly` упразднены.

Расположение: `/projects/dashboard/backend/ollama-usage/`

## Структура

```
backend/ollama-usage/
├── SKILL.md                          # этот файл — описание модуля
├── scripts/
│   ├── ollama-usage.py               # парсинг /settings + сборка JSON
│   ├── ollama_forecast.py            # ядро прогноза (тарифы, burn rate, дефицит)
│   └── ollama-usage-dashboard.sh     # обёртка для cron
├── tests/
│   ├── test_parse.py                 # разметка free/pro + прогноз
│   └── test_forecast.py              # ядро: тарифы, peak-веса, границы цикла
└── references/
    ├── ollama-usage-widget.js        # виджет для дашборда
    └── dashboard-integration.md      # инструкция по интеграции
```

## JSON Output

Скрипт пишет JSON в `/projects/dashboard/data/ollama-usage.json`.

Структура:
```json
{
  "plan": "pro",
  "usage": {
    "percent": 2.3,
    "used": 1.39,
    "limit": 60.0,
    "currency": "$",
    "resets_at": "2026-10-10T19:49:02Z",
    "depletes_at": "2026-09-20T11:20:12Z",
    "models": [
      { "model": "glm-5.3-flash", "requests": 224, "percent": 100.0,
        "cost_usd": 2.28 }
    ],
    "forecast": {
      "basis": "usd",
      "burn_usd_per_day": 6.89,
      "burn_pct_per_day": 11.48,
      "elapsed_days": 0.83, "left_days": 29.17,
      "days_left": 7.87, "depletes_at": "2026-09-19T12:39:09Z",
      "lasts_full_cycle": false,
      "deficit_days": 21.3, "shortfall_usd": 146.86,
      "sustainable_usd_per_day": 1.86, "reduction_factor": 3.7,
      "cost_breakdown": {
        "total_in": 11430000, "total_out": 1450000, "total_cache": 173490000,
        "cost_in_usd": 1.96, "cost_out_usd": 1.0, "cost_cache_usd": 0.97,
        "weighted_cost_usd": 3.93, "calibration": 1.45,
        "models": [ { "model": "...", "priced": true, "cost_usd": 2.9 } ]
      }
    }
  },
  "fetched_at": "2026-09-11T06:59:51Z"
}
```

- `plan` — бейдж тарифа (`free` / `pro` / `max`) рядом с "Included usage"
- `usage.percent` — процент месячного Included usage, уже использованный
- `usage.used` / `usage.limit` / `usage.currency` — абсолютный расход
  (`$1.39 of $60`); есть только на платных тарифах, на free — `null`
- `usage.resets_at` — дата сброса пула (строка "Resets in ...")
- `usage.depletes_at` — дата исчерпания пула; `null`, если пул переживёт период.
  Считается в `ollama_forecast.build_forecast` по **абсолютным** `used`/`limit`
  (на free — по проценту), а не по округлённому проценту
- `usage.models[].cost_usd` — абсолютный расход модели: доля трека × общий расход
- `usage.forecast` — полный разбор прогноза: темп в $/день, дефицит, во сколько
  раз надо сократить расход, структура стоимости по типам токенов
  (`cost_breakdown`: вход / выход / кэш с peak-тарифами, `calibration` — во
  сколько раз расчётная стоимость отличается от факта с сайта)
- `usage.models` — модели месяца: `requests` (кол-во запросов) и `percent` (доля usage из трека)

### Разметка тарифов (важно для парсинга)

Разметка `/settings` отличается между free и платными тарифами:

| Тариф | `aria-label` трека | Процент |
|-------|--------------------|---------|
| free  | `Monthly usage 3% used` | в тексте |
| pro/max | `Monthly usage $1.39 of $60 used` | только в ширине заливки |

Инвариант для обоих — `style="width: N%"` у заливки внутри `data-usage-track`.
Парсер берёт процент из `aria-label`, а если там денежный формат — из ширины
заливки, и дополнительно вытаскивает `used`/`limit`/`currency` из `aria-label`.

## Как это работает

1. **Cron** (каждые 30 мин) запускает `ollama-usage-dashboard.sh`
2. Скрипт дёргает `ollama.com/settings` с session cookie
3. Парсит HTML, собирает JSON
4. Пишет в `/projects/dashboard/data/ollama-usage.json`
5. Docker volume монтирует эту папку в backend-контейнер как `/ollama-data:ro`
6. Backend читает файл и отдаёт через `/api/ollama-usage`
7. Виджет `ollama-usage.js` отображает данные на дашборде

## Настройка

### 1. Сохранить session cookie

```bash
python3 /projects/dashboard/backend/ollama-usage/scripts/ollama-usage.py \
  --save-cookie "<ваша-__Secure-session-кука>"
```

### 2. Настроить cron

```bash
cronjob action=create name="Ollama Cloud Usage" \
  schedule="every 30m" \
  script="ollama-usage-dashboard.sh" \
  no_agent=true
```

### 3. Проверить

```bash
python3 /projects/dashboard/backend/ollama-usage/scripts/ollama-usage.py
curl http://127.0.0.1:9090/api/ollama-usage
```

## CLI-отчёт по бюджету

Парсер умеет печатать прогноз в терминал, а в скиле `ollama-usage` есть
обёртка для Telegram-отчёта (использует то же ядро, цифры совпадают):

```bash
# краткий вывод с прогнозом и разбивкой по типам токенов
python3 backend/ollama-usage/scripts/ollama-usage.py --verbose

# без разбора state.db (быстрее, только прогноз по $)
python3 backend/ollama-usage/scripts/ollama-usage.py --no-tokens

# отчёт для Telegram (обёртка из скила)
python3 ~/.hermes/profiles/hermesa/skills/devops/ollama-usage/scripts/ollama-budget.py
```

Пример вывода:

```
Included usage: 9.4% used — $5.65 of $60 (resets in 29d 4h)
Burn rate: $6.85/day (11.4167%/day) over 0.825d elapsed
Projected depletion: in 7d 22h (in 7.93d at current rate)
⚠ Shortfall: 21.24d before reset, ~$145.5 extra needed; cut usage ×3.677

Cost by token type (with peak rates):
  input:  11.4M → $1.952
  output: 1.44M → $0.9841
  cache:  168.6M → $0.9557
```

## Тарифы (для расчёта стоимости)

`$` за 1M токенов: (вход, кэш-вход, выход). Peak — 12:00–18:00 UTC, Пн–Пт
(у deepseek ×2; у остальных надбавки нет). Доля недели в peak: `30/168`.

| Модель | Вход | Кэш | Выход |
|--------|------|-----|-------|
| deepseek-v4.1-flash | 0.15 | 0.003 | 0.60 |
| deepseek-v4-flash | 0.22 | 0.007 | 0.66 |
| glm-5.3-flash | 0.15 | 0.03 | 0.50 |
| kimi-k2.6 | 0.95 | 0.16 | 4.00 |
| minimax-m3 | 0.60 | 0.12 | 2.40 |

Полная таблица и peak-цены — https://ollama.com/pricing

## Pitfalls

- **Фильтр токенов по `first_seen`, не `last_seen`.** `session_model_usage`
  хранит кумулятивную строку на (сессию, модель) — сумму всех вызовов сессии,
  а не вызовов внутри окна. Фильтр по `last_seen` затянет в текущий цикл
  старую сессию целиком: в реальном замере это дало ×2.1 завышение (сессия
  от 16 августа принесла 41.6M токенов в цикл, начавшийся 10 сентября).
- **Абсолютные `$` точнее процента.** Процент округлён до 0.1%: в начале
  периода реальные 0.14% против показанных 0.1% дают ошибку прогноза ~40%.
  Расчёт по `used`/`limit` совпал с прогнозом сайта до минуты, расчёт по
  проценту расходился на 20+ минут.
- **Калибровка к сайту ×1.4–1.5 — норма, не баг.** Сайт списывает по своим
  токенам, часть из них (включая серверный кэш) локально не записывается.
  Смотри на `calibration` как на индикатор: если она ушла далеко за
  1.2–2.0, проверь границу цикла и наличие тарифа для всех моделей.
- **Фронтенд — build, не restart.** Статика копируется в образ при сборке
  (`COPY assets/`), поэтому `docker compose restart` не подхватит правки
  JS/CSS. Нужно `docker compose build && docker compose up -d`.
- **Модель без тарифа даёт `$0.00`** и занижает сумму — в отчёте такие
  помечены `priced: false`. При появлении новой модели дополни `PRICES`
  в `ollama_forecast.py`.

## Поведение при ошибках

| Состояние | Exit code | Stdout | Доставка |
|-----------|-----------|--------|----------|
| ✅ Всё ОК | 0 | пустой | Silent |
| ❌ Сессия истекла | 0 (через обёртку) | инструкция | Telegram |
| ⚠️ HTTP/сетевая ошибка | 0 (через обёртку) | сообщение | Telegram |
