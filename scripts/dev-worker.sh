#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT_DIR"

if [ -z "${DATABASE_URL:-}" ]; then
  DATABASE_URL="$(bash scripts/local-db-url.sh)"
fi
export DATABASE_URL

exec npx tsx src/worker/index.ts
