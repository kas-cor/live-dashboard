#!/usr/bin/env bash
# Wrapper for cron: fetch Codex (ChatGPT plan) usage limits into the dashboard data dir.
# Mirrors backend/ollama-usage/scripts/ollama-usage-dashboard.sh.
set -euo pipefail

REPO_DIR="${CODEX_USAGE_REPO_DIR:-/projects/dashboard}"
OUT_DIR="${CODEX_USAGE_OUT_DIR:-$REPO_DIR/data}"

mkdir -p "$OUT_DIR"
export CODEX_USAGE_OUT="$OUT_DIR/codex-usage.json"

exec python3 "$REPO_DIR/backend/codex-usage/scripts/codex-usage.py"
