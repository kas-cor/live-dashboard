# Live Dashboard

Модульный дашборд для второго монитора с киберпанк-темой. 10 виджетов + легкое добавление новых.

## Пересборка и деплой

Для удобной пересборки всего проекта (frontend + backend, с очисткой кеша и пересозданием контейнеров) используйте:

```bash
cd /projects/dashboard
./rebuild.sh      # или: make rebuild
```

Команда выполняет:
1. `docker compose build --no-cache` — полная пересборка всех образов
2. `docker compose up -d --force-recreate` — пересоздание и запуск контейнеров
3. Выводит статус контейнеров и версию встроенного фронтенда

### Makefile — целевые команды

```bash
make rebuild        # полная пересборка и перезапуск (через rebuild.sh)
make up             # поднять контейнеры
make down           # остановить контейнеры
make logs           # логи всех сервисов
make backend-logs   # логи бэкенда
make frontend-logs  # логи фронтенда
make status         # статус контейнеров
```

**Пересборка только frontend** (если меняли JS/CSS/HTML):
```bash
docker compose build --no-cache frontend
docker stop dashboard-frontend && docker rm dashboard-frontend
docker compose up -d frontend
```

**Пересборка только backend** (если меняли backend.py или .env):
```bash
docker compose build --no-cache backend
docker stop dashboard-backend && docker rm dashboard-backend
docker compose up -d backend
```

## Запуск (Docker Compose)

```bash
cd /projects/dashboard
docker compose up -d
```

Открой `http://localhost:3003` на втором мониторе.

**Сервисы:**
- Frontend (nginx): `localhost:3003` — дашборд + proxy `/api/*`
- Backend (FastAPI): `localhost:9090` — API endpoints

**Пересборка после изменений:**
```bash
docker compose up -d --build
```

## Архитектура

```
assets/js/core.js          — Dashboard + BaseWidget
assets/js/widgets/*.js     — плагины
assets/css/dashboard.css   — единая тема
api/servers.json           — мок для серверов
backend.py                 — FastAPI с 7 endpoints
```

## Как добавить виджет

1. Создай `assets/js/widgets/mywidget.js`:

```javascript
class MyWidget extends BaseWidget {
  constructor(id, options) {
    super(id, options);
    this.size = 'medium'; // small | medium | large
  }

  render() {
    // this.element уже создан — заполни HTML
    this.element.innerHTML = `
      <div class="widget-header"><h3>Title</h3></div>
      <div class="widget-body">...</div>
    `;
  }

  async update() {
    // Получи данные, обнови DOM
    // this.element.querySelector('.value').textContent = 42;
  }
}
window.MyWidget = MyWidget;
```

2. Подключи в `index.html`.
3. Зарегистрируй: `dashboard.register(new MyWidget('id', { interval: 5000 }))`.

Система сама: вызывает `render()` → `update()` → `start(interval)`. При ошибках виджет не ломает соседей.

## Встроенные виджеты

| Виджет | Интервал | Источник |
|--------|----------|----------|
| Clock | 1s | Локальный |
| Weather | 5min | Open-Meteo API |
| Crypto | 1min | CoinGecko API |
| Network | 2s | Fetch self HEAD |
| System Load | 3s | backend /api/sysinfo |
| Server Status | 5s | backend /api/servers.json |
| TODO | 30s | backend /api/todo |
| Docker | 10s | backend /api/docker |
| Tailscale | 15s | backend /api/tailscale |
| Logs | 5s | backend /api/logs |

Все системные виджеты работают и с мок-данными при недоступном бэкенде.

## Docker контейнеризация (опционально)

```dockerfile
FROM python:3.11-slim
WORKDIR /app
COPY backend.py .
RUN pip install fastapi uvicorn
EXPOSE 9090
CMD ["python", "backend.py"]
```
