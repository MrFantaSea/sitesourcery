#!/bin/sh
set -eu

project_directory=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
test_directory=$(mktemp -d "${TMPDIR:-/tmp}/sitesourcery-d1-test.XXXXXX")
database_path="$test_directory/data-plane.sqlite"

cleanup() {
  rm -f "$database_path"
  rmdir "$test_directory"
}
trap cleanup EXIT HUP INT TERM

for migration in "$project_directory"/d1/migrations/*.sql; do
  sqlite3 -bail "$database_path" ".read $migration"
done

sqlite3 -bail "$database_path" \
  ".read $project_directory/d1/tests/schema-invariants.sql"

foreign_key_failures=$(
  sqlite3 -bail "$database_path" "PRAGMA foreign_key_check;"
)
if [ -n "$foreign_key_failures" ]; then
  printf '%s\n' "$foreign_key_failures" >&2
  exit 1
fi

node --test "$project_directory/d1/tests/data-plane.test.mjs"

