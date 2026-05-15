#!/bin/bash
set -e

cd /projects/dashboard

echo "=== Rebuilding dashboard images ==="
docker compose build --no-cache

echo ""
echo "=== Restarting containers ==="
docker compose up -d --force-recreate

echo ""
echo "=== Container status ==="
docker compose ps

echo ""
echo "=== Frontend version ==="
curl -s http://${DASHBOARD_HOST:-127.0.0.1}:${DASHBOARD_PORT:-3003}/ | grep -o 'v=[a-f0-9]*' | head -1
