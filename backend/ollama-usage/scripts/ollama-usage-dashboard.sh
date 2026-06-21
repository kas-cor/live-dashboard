#!/usr/bin/env bash
# Wrapper for ollama-usage.py — writes JSON for the dashboard
# Поведение (для no_agent=true):
#   - Всё ОК → exit 0, пустой stdout → SILENT (ничего не шлём)
#   - Сессия протухла → exit 0, сообщение в stdout → доставка в Telegram

SCRIPT_DIR="$(dirname "$0")"
OUTPUT_FILE="/projects/dashboard/data/ollama-usage.json"

# Запускаем скрипт, ловим stdout+stderr и exit code
OUTPUT=$(python3 "$SCRIPT_DIR/ollama-usage.py" --output-file "$OUTPUT_FILE" 2>&1)
EXIT_CODE=$?

if [ $EXIT_CODE -eq 0 ]; then
  # Всё ок — тихий выход, ничего не выводим
  exit 0
fi

# Проверяем, что именно пошло не так
case "$OUTPUT" in
  *SESSION_EXPIRED*)
    cat << "EOF"
❌ Ollama Cloud: сессия истекла!

Необходимо обновить __Secure-session cookie для ollama.com.

Как обновить:
1. Открой https://ollama.com в браузере (уже должен быть залогинен)
2. DevTools (F12) → Application → Cookies → ollama.com
3. Скопируй значение __Secure-session
4. Отправь мне команду: /update-ollama-cookie <значение>

Или просто напиши мне "обнови куку олламы" и я помогу.
EOF
    ;;
  *HTTP_ERROR*)
    echo "⚠️ Ollama Cloud: HTTP ошибка при проверке usage."
    echo "$OUTPUT"
    ;;
  *CONNECTION_ERROR*)
    echo "⚠️ Ollama Cloud: ошибка соединения — возможно сервер недоступен."
    echo "$OUTPUT"
    ;;
  *)
    echo "⚠️ Ollama Cloud: неизвестная ошибка при проверке usage."
    echo "$OUTPUT"
    ;;
esac

exit 0
