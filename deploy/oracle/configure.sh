#!/usr/bin/env bash
# Interactive secret setup for /etc/makoto/backend.env (no file editing needed).
#   sudo makoto-configure
# Input is hidden; press Enter to keep the current value.
set -Eeuo pipefail

ENV_FILE="${ENV_FILE:-/etc/makoto/backend.env}"
SERVICE="${SERVICE:-makoto-backend}"
HEALTH_URL="${HEALTH_URL:-http://127.0.0.1:3001/api/health}"

die() { printf '\033[1;31m[x] %s\033[0m\n' "$*" >&2; exit 1; }
[ "$(id -u)" -eq 0 ] || [ "${SKIP_ROOT_CHECK:-0}" = "1" ] || die "Run with sudo: sudo makoto-configure"
[ -f "$ENV_FILE" ] || die "$ENV_FILE not found; run setup.sh first"
TTY="${TTY_INPUT:-/dev/tty}"
{ : <"$TTY"; } 2>/dev/null || TTY=/dev/stdin

current() { awk -F= -v k="$1" '$1 == k { sub(/^[^=]*=/, ""); print; exit }' "$ENV_FILE"; }
set_value() {
  local key="$1" value="$2" tmp
  tmp="$(mktemp "$ENV_FILE.XXXXXX")"
  KEY="$key" VALUE="$value" awk -F= '
    BEGIN { done = 0 }
    $1 == ENVIRON["KEY"] && !done { print ENVIRON["KEY"] "=" ENVIRON["VALUE"]; done = 1; next }
    { print }
    END { if (!done) print ENVIRON["KEY"] "=" ENVIRON["VALUE"] }' "$ENV_FILE" > "$tmp"
  chmod 600 "$tmp"
  mv -f "$tmp" "$ENV_FILE"
}

# key|label|secret(1/0)|validation regex
FIELDS=(
  'TASK_SESSION_SECRET|TASK_SESSION_SECRET (same value as Railway, keeps users signed in)|1|^.{32,}$'
  'SURF_API_KEY|SURF_API_KEY|1|^[^[:space:]]{8,}$'
  'COINGECKO_API_KEY|COINGECKO_API_KEY|1|^[^[:space:]]{8,}$'
  'LLM_API_KEY|LLM_API_KEY (OpenAI key; a new key is recommended)|1|^[^[:space:]]{20,}$'
  'LLM_MODEL|LLM_MODEL|0|^[A-Za-z0-9._:-]+$'
  'COINGECKO_API_MODE|COINGECKO_API_MODE (demo or pro)|0|^(demo|pro)$'
)

echo
echo "Makoto backend secrets → $ENV_FILE"
echo "Paste each value from Railway (Variables → Raw Editor). Input is hidden for secrets."
for field in "${FIELDS[@]}"; do
  IFS='|' read -r key label secret pattern <<<"$field"
  now="$(current "$key")"
  if [ -z "$now" ] || [ "$now" = "CHANGE_ME" ]; then status="not set"; elif [ "$secret" = "1" ]; then status="set, ends with …${now: -4}"; else status="$now"; fi
  while :; do
    if [ "$secret" = "1" ]; then
      read -r -s -p "  $label [$status]: " value <"$TTY"; echo
    else
      read -r -p "  $label [$status]: " value <"$TTY"
    fi
    value="${value//$'\r'/}"
    value="$(printf '%s' "$value" | sed -E 's/^[[:space:]]+//; s/[[:space:]]+$//')"
    if [ -z "$value" ]; then
      [ "$status" != "not set" ] && break
      echo "    This value is required."; continue
    fi
    if [[ "$value" =~ $pattern ]]; then set_value "$key" "$value"; break; fi
    echo "    That does not look right; please paste it again."
  done
done

if grep -qE '^[A-Z0-9_]+=CHANGE_ME\s*$' "$ENV_FILE"; then die "Some values are still CHANGE_ME; run sudo makoto-configure again."; fi
echo
echo "Saved. Restarting $SERVICE…"
systemctl restart "$SERVICE"
for _ in $(seq 1 30); do
  if curl -fsS "$HEALTH_URL" >/dev/null 2>&1; then echo "Backend is healthy ✔"; exit 0; fi
  sleep 2
done
journalctl -u "$SERVICE" -n 40 --no-pager || true
die "Backend did not become healthy; check the values and run sudo makoto-configure again."
