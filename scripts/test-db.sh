#!/usr/bin/env bash
# Applies both migrations to a throwaway local PostgreSQL cluster and runs the SQL checks.
# Requires PostgreSQL 15+ binaries (initdb, pg_ctl, psql) on PATH or under /usr/lib/postgresql/*/bin.
set -euo pipefail
cd "$(dirname "$0")/.."
PGBIN="$(dirname "$(command -v initdb 2>/dev/null || ls /usr/lib/postgresql/*/bin/initdb | tail -1)")"
DIR="$(mktemp -d)"
trap '"$PGBIN/pg_ctl" -D "$DIR/data" stop -m immediate >/dev/null 2>&1 || true; rm -rf "$DIR"' EXIT
"$PGBIN/initdb" -D "$DIR/data" -U postgres --auth=trust >/dev/null
"$PGBIN/pg_ctl" -D "$DIR/data" -o "-k $DIR -c listen_addresses=''" -l "$DIR/log" start >/dev/null
PSQL=("$PGBIN/psql" -h "$DIR" -U postgres -d postgres -v ON_ERROR_STOP=1 -q)
"${PSQL[@]}" -f supabase/tests/stubs.sql
for migration in supabase/migrations/*.sql; do
  echo "applying $migration"
  "${PSQL[@]}" -f "$migration"
done
"${PSQL[@]}" -f supabase/tests/workflow_rules.sql
