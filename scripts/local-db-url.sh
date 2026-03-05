#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"

for cmd in initdb pg_ctl psql createdb; do
  if ! command -v "$cmd" >/dev/null 2>&1; then
    echo "Missing required command: $cmd. Install PostgreSQL tools to run local dev." >&2
    exit 1
  fi
done

PGDATA="${LOCAL_PG_DATA:-$ROOT_DIR/.local-pg/data}"
PGPORT="${LOCAL_PG_PORT:-55432}"
PGDB="${LOCAL_PG_DB:-node_interface_demo}"
PGUSER="${LOCAL_PG_USER:-$USER}"

mkdir -p "$PGDATA"

can_connect() {
  psql -h localhost -p "$PGPORT" -U "$PGUSER" -d postgres -tAc "SELECT 1" >/dev/null 2>&1
}

if [ ! -f "$PGDATA/PG_VERSION" ]; then
  initdb -D "$PGDATA" >/dev/null
fi

if ! pg_ctl -D "$PGDATA" status >/dev/null 2>&1; then
  if ! can_connect; then
    pg_ctl -D "$PGDATA" -l "$PGDATA/server.log" -o "-p $PGPORT" start >/dev/null || true
    sleep 1
  fi
fi

if ! can_connect; then
  echo "Failed to connect to local Postgres on localhost:${PGPORT} (user: ${PGUSER})." >&2
  echo "Check ${PGDATA}/server.log for startup errors." >&2
  exit 1
fi

DB_EXISTS="$(psql -h localhost -p "$PGPORT" -U "$PGUSER" -d postgres -tAc "SELECT 1 FROM pg_database WHERE datname='${PGDB}'")"
if [ "$DB_EXISTS" != "1" ]; then
  createdb -h localhost -p "$PGPORT" -U "$PGUSER" "$PGDB"
fi

echo "postgresql://${PGUSER}@localhost:${PGPORT}/${PGDB}?schema=public"
