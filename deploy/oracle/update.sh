#!/usr/bin/env bash
# Update the Makoto backend to the latest commit of its branch and restart it.
#   sudo makoto-update            # pull, install, back up, restart, verify
#   sudo makoto-update --check    # only verify health and show status
set -Eeuo pipefail

APP_DIR=/opt/makoto/app
BRANCH="${BRANCH:-makoto-wallet}"
HEALTH_URL=http://127.0.0.1:3001/api/health

say() { printf '\n\033[1;36m==> %s\033[0m\n' "$*"; }
die() { printf '\033[1;31m[x] %s\033[0m\n' "$*" >&2; exit 1; }

wait_healthy() {
  for _ in $(seq 1 30); do
    if curl -fsS "$HEALTH_URL" >/dev/null 2>&1; then return 0; fi
    sleep 2
  done
  return 1
}

[ "$(id -u)" -eq 0 ] || die "Run with sudo: sudo makoto-update"

if [ "${1:-}" = "--check" ]; then
  systemctl --no-pager --lines=0 status makoto-backend caddy || true
  if wait_healthy; then echo "Health: OK ($(curl -fsS "$HEALTH_URL"))"; exit 0; fi
  journalctl -u makoto-backend -n 40 --no-pager || true
  die "Backend is not healthy."
fi

say "Current version: $(sudo -u makoto git -C "$APP_DIR" log -1 --format='%h %s')"
sudo -u makoto git -C "$APP_DIR" fetch --quiet origin "$BRANCH"
before="$(sudo -u makoto git -C "$APP_DIR" rev-parse HEAD)"
sudo -u makoto git -C "$APP_DIR" merge --ff-only --quiet "origin/$BRANCH" || die "Local changes block a fast-forward update. Nothing was changed."
after="$(sudo -u makoto git -C "$APP_DIR" rev-parse HEAD)"
if [ "$before" = "$after" ] && [ "${1:-}" != "--force" ]; then
  echo "Already up to date."
  exit 0
fi
say "New version: $(sudo -u makoto git -C "$APP_DIR" log -1 --format='%h %s')"

say "Installing backend dependencies"
sudo -u makoto -H bash -c "cd '$APP_DIR/backend' && npm ci --omit=dev --no-audit --no-fund"

say "Backing up data before restart"
/usr/local/bin/makoto-backup

# Pick up unit file changes shipped with the update.
install -o root -g root -m 0644 "$APP_DIR/deploy/oracle/makoto-backend.service" /etc/systemd/system/makoto-backend.service
systemctl daemon-reload

say "Restarting"
systemctl restart makoto-backend
if wait_healthy; then
  say "Update complete and healthy."
else
  journalctl -u makoto-backend -n 60 --no-pager || true
  echo
  echo "To roll back to the previous version:"
  echo "  sudo -u makoto git -C $APP_DIR reset --hard $before && sudo makoto-update --force"
  die "Backend is not healthy after the update."
fi
