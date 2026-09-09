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
└── references/
    ├── ollama-usage-widget.js        # виджет для дашборда
    └── dashboard-integration.md      # инструкция по интеграции
```

## JSON Output

Скрипт пишет JSON в `/projects/dashboard/data/ollama-usage.json`.

Структура:
```json
{
  "plan": "free",
  "usage": {
    "percent": 0.4,
    "resets_at": "2026-10-04T05:11:16Z",
    "models": [
      { "model": "nemotron-3-super", "requests": 5, "percent": 78.6 },
      { "model": "gpt-oss:120b", "requests": 1, "percent": 21.4 }
    ]
  },
  "fetched_at": "2026-09-09T08:09:38Z"
}
```

- `plan` — бейдж тарифа (`free` / `pro` / `max`) рядом с "Included usage"
- `usage.percent` — процент месячного Included usage, уже использованный
- `usage.resets_at` — дата сброса пула (строка "Resets in ...")
- `usage.models` — модели месяца: `requests` (кол-во запросов) и `percent` (доля usage из трека)

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
