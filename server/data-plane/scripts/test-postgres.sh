#!/bin/sh
set -eu

if [ -z "${DATABASE_URL:-}" ]; then
  printf '%s\n' "DATABASE_URL is required for PostgreSQL reference validation." >&2
  exit 2
fi

project_directory=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)

node --test "$project_directory/tests/postgres-migration-structure.test.mjs"

psql "$DATABASE_URL" -v ON_ERROR_STOP=1 \
  -f "$project_directory/tests/postgres-bootstrap.sql"

for migration in "$project_directory"/supabase/migrations/*.sql; do
  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f "$migration"
done

psql "$DATABASE_URL" -v ON_ERROR_STOP=1 \
  -f "$project_directory/tests/postgres-invariants.sql"
