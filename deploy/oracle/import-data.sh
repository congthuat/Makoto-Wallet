#!/usr/bin/env bash
# Import Makoto SQLite databases (e.g. exported from Railway) into this server.
#   sudo makoto-import-data /path/to/folder
# The folder must contain task-auth.sqlite, tasks.sqlite and portfolio-history.sqlite
# (a missing file is allowed only with ALLOW_PARTIAL=1). Every file is verified
# before anything is replaced, and the current data is backed up first.
set -Eeuo pipefail

DATA_DIR="${DATA_DIR:-/var/lib/makoto}"
SERVICE="${SERVICE:-makoto-backend}"
OWNER="${OWNER:-makoto}"
HEALTH_URL="${HEALTH_URL:-http://127.0.0.1:3001/api/health}"
ALLOW_PARTIAL="${ALLOW_PARTIAL:-0}"
# name:required_table
DATABASES=(task-auth:sessions tasks:tasks portfolio-history:portfolio_history)

die() { printf '\033[1;31m[x] %s\033[0m\n' "$*" >&2; exit 1; }
say() { printf '\n\033[1;36m==> %s\033[0m\n' "$*"; }

src_dir="${1:-}"
[ -n "$src_dir" ] && [ -d "$src_dir" ] || die "Usage: sudo makoto-import-data /path/to/folder-with-sqlite-files"
[ "$(id -u)" -eq 0 ] || [ "${SKIP_ROOT_CHECK:-0}" = "1" ] || die "Run with sudo"

say "Verifying files in $src_dir"
present=()
for entry in "${DATABASES[@]}"; do
  name="${entry%%:*}"; table="${entry#*:}"
  file="$src_dir/$name.sqlite"
  if [ ! -f "$file" ]; then
    [ "$ALLOW_PARTIAL" = "1" ] || die "Missing $file (set ALLOW_PARTIAL=1 to import only the files present)"
    echo "skip $name (not provided)"
    continue
  fi
  [ ! -e "$file-wal" ] || die "$file-wal exists: export with the provided railway-export (VACUUM INTO), not a raw copy"
  result="$(sqlite3 -readonly "$file" 'PRAGMA integrity_check;')" || die "$file is not a readable SQLite database"
  [ "$result" = "ok" ] || die "$file failed integrity_check: $result"
  has_table="$(sqlite3 -readonly "$file" "SELECT count(*) FROM sqlite_master WHERE type='table' AND name='$table';")"
  [ "$has_table" = "1" ] || die "$file does not look like the Makoto $name database (table '$table' missing)"
  rows="$(sqlite3 -readonly "$file" "SELECT count(*) FROM $table;")"
  echo "ok   $name ($table: $rows rows)"
  present+=("$name")
done
[ "${#present[@]}" -gt 0 ] || die "No database files to import"

say "Stopping $SERVICE"
systemctl stop "$SERVICE"
trap 'echo; echo "Import interrupted; starting $SERVICE again."; systemctl start "$SERVICE" || true' ERR

say "Backing up current data"
if command -v makoto-backup >/dev/null 2>&1; then makoto-backup; else DATA_DIR="$DATA_DIR" "$(dirname "$0")/backup.sh"; fi

say "Replacing data"
install -d -o "$OWNER" -g "$OWNER" -m 0700 "$DATA_DIR"
for name in "${present[@]}"; do
  rm -f -- "$DATA_DIR/$name.sqlite" "$DATA_DIR/$name.sqlite-wal" "$DATA_DIR/$name.sqlite-shm"
  install -o "$OWNER" -g "$OWNER" -m 0600 "$src_dir/$name.sqlite" "$DATA_DIR/$name.sqlite"
  echo "imported $name"
done

say "Starting $SERVICE"
systemctl start "$SERVICE"
trap - ERR
for _ in $(seq 1 30); do
  if curl -fsS "$HEALTH_URL" >/dev/null 2>&1; then
    say "Import complete; backend is healthy."
    exit 0
  fi
  sleep 2
done
journalctl -u "$SERVICE" -n 40 --no-pager || true
die "Backend did not become healthy after the import. The previous data is in /var/backups/makoto."
