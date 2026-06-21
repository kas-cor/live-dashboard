---
name: ollama-usage
description: Monitor Ollama Cloud usage (session/weekly limits).
version: 1.0.0
author: Aleksandr
license: MIT
platforms: [linux]
---

# Ollama Cloud Usage — Backend Module

Парсит данные об использовании Ollama Cloud с `ollama.com/settings` через session cookie и передаёт их в дашборд.

Расположение: `/projects/dashboard/backend/ollama-usage/`

## Структура

```
backend/ollama-usage/
├── SKILL.md                          # этот файл — описание модуля
├── scripts/
│   ├── ollama-usage.py               # основной скрипт парсинга
│   └── ollama-usage-dashboard.sh     # обёртка для cron
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

## Как это работает

1. **Cron** (каждые 30 мин) запускает `ollama-usage-dashboard.sh`
2. Скрипт дёргает `ollama.com/settings` и `ollama.com/settings/billing` с session cookie
3. Парсит HTML, собирает JSON
4. Пишет в `/projects/dashboard/data/ollama-usage.json`
5. Docker volume монтирует эту папку в backend-контейнер как `/ollama-data:ro`
6. Backend читает файл и отдаёт через `/api/ollama-usage`
7. Виджет `ollama-usage.js` отображает данные на дашборде

## Настройка

### 1. Сохранить session cookie

```bash
python3 /projects/dashboard/backend/ollama-usage/scripts/ollama-usage.py \
  --save-cookie "YWdlLWVuY3J5cHRpb24ub3JnL3Yx..."
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
