# Live Dashboard

[![License](https://img.shields.io/github/license/kas-cor/live-dashboard)](LICENSE)
[![GitHub](https://img.shields.io/badge/GitHub-kas--cor/live-dashboard-181717?logo=github)](https://github.com/kas-cor/live-dashboard)

> 🇬🇧 [English version](README.md)

Модульный дашборд для второго монитора с киберпанк-темой. 10+ виджетов, FastAPI бэкенд, Docker Compose, и **alert webhook** для отправки уведомлений ИИ-агентам.

## Возможности

- 🕐 **10+ виджетов** — Часы, Погода, Крипта, Сеть, Нагрузка системы, Серверы, Сайты, TODO, Docker, Tailscale, Логи
- 🤖 **Alert webhook** — автоматические уведомления при превышении CPU/RAM/диска, отключении серверов, остановке контейнеров или недоступности сайтов
- 🖥️ **Мониторинг удалённых серверов** — SSH-сбор метрик с любого количества серверов
- 🐳 **Docker Compose** — деплой одной командой
- 🌗 **Киберпанк-тема** — тёмная, неоновая эстетика для второго монитора
- 📦 **Плагинные виджеты** — легко добавлять новые через класс `BaseWidget`

## Быстрый старт

```bash
git clone https://github.com/kas-cor/live-dashboard.git
cd live-dashboard
cp .env.sample .env
# Отредактируйте .env под себя
docker compose up -d
# Откройте http://localhost:3003
```

## Встроенные виджеты

| Виджет | Интервал | Источник |
|--------|----------|----------|
| Часы | 1с | Локальный |
| Погода | 5мин | Open-Meteo API |
| Крипта | 1мин | CoinGecko API |
| Сеть | 2с | HTTP HEAD |
| Нагрузка | 3с | FastAPI |
| Серверы | 15с | SSH |
| Сайты | 1мин | HTTP GET |
| TODO | 30с | JSON файл |
| Docker | 10с | Docker socket |
| Tailscale | 15с | Tailscale CLI |
| Логи | 5с | journalctl |

## Alert Webhook для ИИ-агентов

Настройка в `.env`:
```bash
ALERT_WEBHOOK_URL=https://your-agent-endpoint/webhook
ALERT_WEBHOOK_AUTH_TOKEN=your-token
ALERT_COOLDOWN_MINUTES=10
```

## Управление

```bash
make rebuild        # Полная пересборка + перезапуск
make up             # Запустить контейнеры
make down           # Остановить контейнеры
make logs           # Все логи
make status         # Статус контейнеров
```

---

<p align="center">
  <a href="README.md">🇬🇧 English version</a>
  &nbsp;·&nbsp;
  <a href="https://github.com/kas-cor/live-dashboard/issues">🐛 Сообщить об ошибке</a>
</p>