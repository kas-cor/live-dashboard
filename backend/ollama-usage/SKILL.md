---
name: ollama-usage
description: Monitor Ollama Cloud usage (session/weekly limits).
version: 1.0.0
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
│   ├── ollama-usage.py               # основной скрипт парсинга
│   └── ollama-usage-dashboard.sh     # обёртка для cron
├── tests/
│   └── test_parse.py                 # тесты парсера (free + pro разметка)
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
      { "model": "glm-5.3-flash", "requests": 224, "percent": 100.0 }
    ]
  },
  "fetched_at": "2026-09-11T06:59:51Z"
}
```

- `plan` — бейдж тарифа (`free` / `pro` / `max`) рядом с "Included usage"
- `usage.percent` — процент месячного Included usage, уже использованный
- `usage.used` / `usage.limit` / `usage.currency` — абсолютный расход
  (`$1.39 of $60`); есть только на платных тарифах, на free — `null`
- `usage.resets_at` — дата сброса пула (строка "Resets in ...")
- `usage.depletes_at` — прогноз исчерпания пула по среднему расходу за
  прошедшую часть периода; `null`, если пул переживёт период
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

## Поведение при ошибках

| Состояние | Exit code | Stdout | Доставка |
|-----------|-----------|--------|----------|
| ✅ Всё ОК | 0 | пустой | Silent |
| ❌ Сессия истекла | 0 (через обёртку) | инструкция | Telegram |
| ⚠️ HTTP/сетевая ошибка | 0 (через обёртку) | сообщение | Telegram |
