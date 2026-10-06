#!/bin/bash
set -e

# Render the host-network listener from the existing Compose settings.
sed -i "s|listen 127.0.0.1:3003;|listen ${DASHBOARD_HOST:-127.0.0.1}:${DASHBOARD_PORT:-3003};|" /etc/nginx/conf.d/default.conf

# Start nginx in background
nginx -g "daemon off;" &
NGINX_PID=$!

# Run backend
python /app/backend.py &
BACKEND_PID=$!

# Trap to stop both on exit
cleanup() {
    kill $NGINX_PID $BACKEND_PID 2>/dev/null
    exit
}
trap cleanup SIGTERM SIGINT

# Wait for either to exit
wait
