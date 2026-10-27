#!/usr/bin/env bash
# Consistent online backup of the three Makoto SQLite databases (SQLite .backup API),
# verified with PRAGMA integrity_check. Keeps the newest $KEEP backups.
#   sudo makoto-backup                 # runs daily from /etc/cron.d/makoto-backup
#   sudo makoto-backup --list          # list backups
set -Eeuo pipefail

DATA_DIR="${DATA_DIR:-/var/lib/makoto}"
BACKUP_DIR="${BACKUP_DIR:-/var/backups/makoto}"
KEEP="${KEEP:-14}"
DATABASES=(task-auth tasks portfolio-history embedded-vaults)

die() { printf '[x] %s\n' "$*" >&2; exit 1; }

if [ "${1:-}" = "--list" ]; then
  ls -1 "$BACKUP_DIR" 2>/dev/null | sort -r || true
  exit 0
fi

umask 077
stamp="$(date -u +%Y%m%dT%H%M%SZ)"
dest="$BACKUP_DIR/$stamp"
mkdir -p "$dest"

saved=0
for name in "${DATABASES[@]}"; do
  src="$DATA_DIR/$name.sqlite"
  if [ ! -f "$src" ]; then
    echo "skip $name (no database yet)"
    continue
  fi
  sqlite3 "$src" ".timeout 15000" ".backup '$dest/$name.sqlite'"
  result="$(sqlite3 "$dest/$name.sqlite" 'PRAGMA integrity_check;')"
  [ "$result" = "ok" ] || die "Backup of $name failed integrity_check: $result"
  echo "ok   $name ($(du -h "$dest/$name.sqlite" | cut -f1))"
  saved=$((saved + 1))
done

if [ "$saved" -eq 0 ]; then
  rmdir "$dest"
  echo "Nothing to back up yet."
  exit 0
fi
echo "Backup saved: $dest"

# Retention: keep the newest $KEEP timestamped backup directories.
mapfile -t old < <(find "$BACKUP_DIR" -mindepth 1 -maxdepth 1 -type d -name '20*' | sort -r | tail -n +"$((KEEP + 1))")
for dir in "${old[@]}"; do rm -rf -- "$dir"; done
