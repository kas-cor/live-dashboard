---
name: codex-usage
description: Monitor OpenAI Codex (ChatGPT plan) usage limits on the dashboard.
version: 1.0.0
author: Aleksandr
license: MIT
platforms: [linux]
---

# Codex Usage — Backend Module

Скрипт читает OAuth-токен `~/.codex/auth.json` (писался `codex login`), дёргает тот
же usage-эндпоинт, что использует Codex CLI, и пишет JSON для дашборда.

Расположение: `/projects/dashboard/backend/codex-usage/`

```
backend/codex-usage/
├── SKILL.md                          # этот файл
└── scripts/
    ├── codex-usage.py                # сбор + запись JSON
    └── codex-usage-dashboard.sh      # обёртка для cron
```

## Эндпоинт и заголовки

`GET https://chatgpt.com/backend-api/codex/usage`

Ключевой момент: эндпоинт отдаёт **403**, если запрос не похож на запрос самого
CLI. Минимально необходимый набор (проверено 03.10.2026):

| Заголовок | Значение |
|---|---|
| `Authorization` | `Bearer <access_token>` из `auth.json` |
| `User-Agent` | `codex_cli_rs/<версия>` |
| `Accept` | `application/json` |
| `Origin` | `https://chatgpt.com` |
| `x-codex-installation-id` | содержимое `~/.codex/installation_id` |
| `x-openai-ct` | `ct=v1` |

## Ротация токенов

`https://auth.openai.com/oauth/token` (grant_type=refresh_token,
client_id=`app_EMoamEEZ73f0CkXaXp7hrann`) **ротирует refresh-токен** — при
обновлении скрипт обязан сохранить и новый `refresh_token`, иначе доступ
теряется. Запись в `auth.json` — атомарная (mkstemp + os.replace).

Если access-токен устарел, скрипт делает один refresh и повторяет запрос.

## JSON Output

Скрипт пишет `/projects/dashboard/data/codex-usage.json`:

```json
{
  "plan": "plus",
  "email": "...",
  "fetched_at": "2026-10-03T15:20:00Z",
  "allowed": true,
  "limit_reached": false,
  "windows": {
    "primary":   { "used_percent": 6, "window_seconds": 18000,  "reset_at": 1791068446, "reset_in_seconds": 12704 },
    "secondary": { "used_percent": 3, "window_seconds": 604800, "reset_at": 1791585509, "reset_in_seconds": 529766 }
  },
  "credits": { "has_credits": false, "unlimited": false, "balance": "0" },
  "model_usage": { "gpt-6-astra": { "available": true } }
}
```

- `windows.primary` — скользящее окно (18000 с = 5 ч)
- `windows.secondary` — недельное окно (604800 с); у других планов может быть
  другим — заголовок виджет строит из `window_seconds`, а не хардкодом
- `limit_reached` — жёсткий стоп (бейдж в виджете)
- `credits` — докупленные кредиты сверх плана

## Как это работает

1. **Cron** запускает `codex-usage-dashboard.sh`
2. Скрипт читает `~/.codex/auth.json`, при 401/403 — refresh + повтор
3. JSON → `/projects/dashboard/data/codex-usage.json`
4. Docker volume `data:/ollama-data:ro` (тот же том, что у ollama-usage) →
   backend `/api/codex-usage` → виджет `assets/js/widgets/codex-usage.js`
5. После правки JS/CSS: `docker compose build && up -d dashboard` (виджет
   запекается в образ)

## Безопасность

- Токен **никогда** не попадает в JSON, дашборд или git — только read в скрипте.
- `auth.json` — права 600; при записи скрипт сохраняет 600.
- Не коммитить `auth.json`, `installation_id`.

## Тарифные лимиты (контекст, Plus)

Ограничения Codex на ChatGPT-планах — не деньги, а окна: 5-часовое + недельное,
норма зависит от модели (см. chatgpt.com/codex/pricing). `plan_type` из ответа
даёт план аккаунта (`plus`/`pro`/...).
