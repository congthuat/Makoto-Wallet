#!/usr/bin/env bash
# Makoto Wallet backend — one-time (and safely re-runnable) setup for an
# Oracle Cloud Always Free VM running Ubuntu 22.04/24.04 (ARM or x86).
#
#   curl -fsSL https://raw.githubusercontent.com/congthuat/Makoto-Wallet/makoto-wallet/deploy/oracle/setup.sh | sudo bash
#
# Optional environment overrides: API_DOMAIN, REPO_URL, BRANCH, DRY_RUN=1 (print only).
set -Eeuo pipefail

API_DOMAIN="${API_DOMAIN:-api.makotowallet.xyz}"
REPO_URL="${REPO_URL:-https://github.com/congthuat/Makoto-Wallet.git}"
BRANCH="${BRANCH:-makoto-wallet}"
DRY_RUN="${DRY_RUN:-0}"

APP_ROOT=/opt/makoto
APP_DIR="$APP_ROOT/app"
DEPLOY_DIR="$APP_DIR/deploy/oracle"
DATA_DIR=/var/lib/makoto
ENV_DIR=/etc/makoto
ENV_FILE="$ENV_DIR/backend.env"
BACKUP_DIR=/var/backups/makoto
NODE_MAJOR=24

say() { printf '\n\033[1;36m==> %s\033[0m\n' "$*"; }
warn() { printf '\033[1;33m[!] %s\033[0m\n' "$*" >&2; }
die() { printf '\033[1;31m[x] %s\033[0m\n' "$*" >&2; exit 1; }
run() { if [ "$DRY_RUN" = "1" ]; then printf '[dry-run] %s\n' "$*"; else "$@"; fi; }
trap 'die "Setup failed at line $LINENO. Fix the error above and run the same command again (it is safe to re-run)."' ERR

[ "$DRY_RUN" = "1" ] || [ "$(id -u)" -eq 0 ] || die "Run with sudo: curl ... | sudo bash"
if [ -r /etc/os-release ]; then . /etc/os-release; else ID=unknown; fi
[ "${ID:-}" = "ubuntu" ] || warn "This script is tested on Ubuntu; detected '${ID:-unknown}'."
[[ "$API_DOMAIN" =~ ^[a-z0-9.-]+$ ]] || die "Invalid API_DOMAIN '$API_DOMAIN'"

say "1/8 System packages"
export DEBIAN_FRONTEND=noninteractive
# Fresh Oracle VMs often run unattended-upgrades at first boot; wait for the apt lock.
apt_get() { run apt-get -o DPkg::Lock::Timeout=600 "$@"; }
apt_get update -y
apt_get install -y ca-certificates curl gnupg git sqlite3 iptables-persistent debian-keyring debian-archive-keyring apt-transport-https

# Small VMs (e.g. the 1 GB AMD Micro): add a 2 GB swap file so npm and Node never run out of memory.
mem_kb="$(awk '/^MemTotal:/ { print $2 }' /proc/meminfo 2>/dev/null || echo 0)"
if [ "${mem_kb:-0}" -lt 2000000 ] && ! swapon --show=NAME --noheadings 2>/dev/null | grep -q .; then
  if [ "$DRY_RUN" = "1" ]; then echo "[dry-run] create 2 GB /swapfile"; else
    [ -f /swapfile ] || { fallocate -l 2G /swapfile 2>/dev/null || dd if=/dev/zero of=/swapfile bs=1M count=2048 status=none; }
    chmod 600 /swapfile
    mkswap /swapfile >/dev/null 2>&1 || true
    swapon /swapfile
    grep -q '^/swapfile ' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
    sysctl -q vm.swappiness=10 && echo 'vm.swappiness=10' > /etc/sysctl.d/99-makoto-swap.conf
    echo "Added 2 GB swap (low-memory VM)"
  fi
fi

say "2/8 Node.js $NODE_MAJOR"
current_major="$(node -v 2>/dev/null | sed -E 's/^v([0-9]+).*/\1/' || true)"
if [ "${current_major:-0}" != "$NODE_MAJOR" ]; then
  run install -d -m 0755 /etc/apt/keyrings
  if [ "$DRY_RUN" = "1" ]; then echo "[dry-run] add NodeSource node_$NODE_MAJOR.x repository"; else
    curl -fsSL https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key | gpg --dearmor --yes -o /etc/apt/keyrings/nodesource.gpg
    echo "deb [signed-by=/etc/apt/keyrings/nodesource.gpg] https://deb.nodesource.com/node_$NODE_MAJOR.x nodistro main" > /etc/apt/sources.list.d/nodesource.list
  fi
  apt_get update -y
  apt_get install -y nodejs
fi
[ "$DRY_RUN" = "1" ] || node -e "process.exit(Number(process.versions.node.split('.')[0]) >= $NODE_MAJOR ? 0 : 1)" || die "Node.js $NODE_MAJOR+ is required"

say "3/8 Caddy (automatic HTTPS)"
if ! command -v caddy >/dev/null 2>&1; then
  if [ "$DRY_RUN" = "1" ]; then echo "[dry-run] add Caddy stable repository"; else
    curl -1sLf https://dl.cloudsmith.io/public/caddy/stable/gpg.key | gpg --dearmor --yes -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
    curl -1sLf https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt > /etc/apt/sources.list.d/caddy-stable.list
  fi
  apt_get update -y
  apt_get install -y caddy
fi

say "4/8 User, directories and code"
id makoto >/dev/null 2>&1 || run useradd --system --home-dir "$APP_ROOT" --shell /usr/sbin/nologin makoto
run install -d -o makoto -g makoto -m 0755 "$APP_ROOT"
run install -d -o makoto -g makoto -m 0700 "$DATA_DIR"
run install -d -o root -g root -m 0700 "$ENV_DIR" "$BACKUP_DIR"
if [ -d "$APP_DIR/.git" ]; then
  run sudo -u makoto git -C "$APP_DIR" fetch --quiet origin "$BRANCH"
  run sudo -u makoto git -C "$APP_DIR" checkout --quiet "$BRANCH"
  run sudo -u makoto git -C "$APP_DIR" merge --ff-only --quiet "origin/$BRANCH"
else
  run sudo -u makoto git clone --quiet --branch "$BRANCH" "$REPO_URL" "$APP_DIR"
fi
run sudo -u makoto -H bash -c "cd '$APP_DIR/backend' && npm ci --omit=dev --no-audit --no-fund"

say "5/8 Configuration ($ENV_FILE)"
if [ ! -f "$ENV_FILE" ]; then
  run install -o root -g root -m 0600 "$DEPLOY_DIR/backend.env.example" "$ENV_FILE"
  warn "Created $ENV_FILE from the template — run: sudo makoto-configure"
else
  run chmod 0600 "$ENV_FILE"
  echo "Keeping existing $ENV_FILE"
fi

say "6/8 Firewall (ports 80/443; app port 3001 stays private)"
for port in 80 443; do
  if ! iptables -C INPUT -p tcp -m state --state NEW --dport "$port" -j ACCEPT 2>/dev/null; then
    # Oracle Ubuntu images end INPUT with a catch-all REJECT; insert before it (or append if none).
    reject_line="$(iptables -L INPUT --line-numbers -n 2>/dev/null | awk '$2 == "REJECT" { print $1; exit }')"
    if [ -n "$reject_line" ]; then
      run iptables -I INPUT "$reject_line" -p tcp -m state --state NEW --dport "$port" -j ACCEPT
    else
      run iptables -A INPUT -p tcp -m state --state NEW --dport "$port" -j ACCEPT
    fi
  fi
done
run netfilter-persistent save

say "7/8 systemd service, Caddy site, daily backup"
run install -o root -g root -m 0644 "$DEPLOY_DIR/makoto-backend.service" /etc/systemd/system/makoto-backend.service
if [ "$DRY_RUN" = "1" ]; then echo "[dry-run] write /etc/caddy/Caddyfile for $API_DOMAIN"; else
  sed "s/{\$MAKOTO_API_DOMAIN}/$API_DOMAIN/" "$DEPLOY_DIR/Caddyfile" > /etc/caddy/Caddyfile
  install -d -o caddy -g caddy -m 0755 /var/log/caddy
  # Repair logs created by an older version of this script (root-owned → Caddy cannot start).
  chown -R caddy:caddy /var/log/caddy
  # Validate as the caddy user: run as root, validation creates a root-owned access
  # log that the caddy service then cannot open, and Caddy refuses to start.
  sudo -u caddy -H caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile >/dev/null
  chown -R caddy:caddy /var/log/caddy
fi
for tool in update backup import-data railway-export configure; do
  run ln -sf "$DEPLOY_DIR/$tool.sh" "/usr/local/bin/makoto-$tool"
done
if [ "$DRY_RUN" = "1" ]; then echo "[dry-run] install /etc/cron.d/makoto-backup"; else
  printf 'SHELL=/bin/bash\n17 3 * * * root /usr/local/bin/makoto-backup >> /var/log/makoto-backup.log 2>&1\n' > /etc/cron.d/makoto-backup
  chmod 0644 /etc/cron.d/makoto-backup
fi
run systemctl daemon-reload
run systemctl enable makoto-backend >/dev/null
run systemctl enable caddy >/dev/null
if ! run systemctl restart caddy; then
  journalctl -u caddy -n 30 --no-pager || true
  die "Caddy (HTTPS) did not start; see the log above."
fi

say "8/8 Start"
if [ "$DRY_RUN" = "1" ]; then echo "[dry-run] start makoto-backend when $ENV_FILE is complete"; exit 0; fi
if grep -qE '^[A-Z0-9_]+=CHANGE_ME\s*$' "$ENV_FILE"; then
  warn "Not starting yet: $ENV_FILE still contains CHANGE_ME."
  echo "Next: sudo makoto-configure   (asks for each secret, then starts the backend)"
  exit 0
fi
systemctl restart makoto-backend
for _ in $(seq 1 30); do
  if curl -fsS http://127.0.0.1:3001/api/health >/dev/null 2>&1; then
    say "Backend is healthy on this server."
    echo "Public check (after DNS points here): curl https://$API_DOMAIN/api/health"
    exit 0
  fi
  sleep 2
done
journalctl -u makoto-backend -n 40 --no-pager || true
die "Backend did not become healthy. See the log above."
