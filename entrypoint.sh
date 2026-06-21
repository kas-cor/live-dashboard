#!/bin/bash
set -e

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
