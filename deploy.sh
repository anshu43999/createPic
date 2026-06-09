#!/usr/bin/env bash
set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

cd "$PROJECT_DIR"

echo "==> Pull latest code"
git pull --ff-only

echo "==> Build and restart Docker service"
if docker compose version >/dev/null 2>&1; then
  docker compose up -d --build
else
  docker-compose up -d --build
fi

echo "==> Service status"
if docker compose version >/dev/null 2>&1; then
  docker compose ps
else
  docker-compose ps
fi

echo "==> Deploy complete"
