#!/usr/bin/env bash
# Copy the Makoto SQLite databases from the Railway backend to this server.
# Run as the normal login user (NOT with sudo):   makoto-railway-export
# Then import them:                               sudo makoto-import-data <folder printed at the end>
set -Eeuo pipefail

DEPLOY_DIR="$(cd "$(dirname "$(readlink -f "$0")")" && pwd)"
SERVICE="${RAILWAY_SERVICE:-}"
OUT_DIR="${OUT_DIR:-$HOME/railway-export-$(date -u +%Y%m%dT%H%M%SZ)}"

say() { printf '\n\033[1;36m==> %s\033[0m\n' "$*"; }
die() { printf '\033[1;31m[x] %s\033[0m\n' "$*" >&2; exit 1; }

[ "$(id -u)" -ne 0 ] || die "Run without sudo (Railway login is stored for your user): makoto-railway-export"
command -v node >/dev/null || die "Node.js is missing; run setup.sh first"

say "1/5 Railway CLI"
if ! command -v railway >/dev/null 2>&1; then
  sudo npm install -g @railway/cli --no-audit --no-fund
fi
railway --version

say "2/5 Railway login (open the link it prints, approve, then come back)"
railway whoami >/dev/null 2>&1 || railway login --browserless
railway whoami

say "3/5 Select the project → production → makoto-backend"
if ! railway status >/dev/null 2>&1; then railway link; fi
railway status

say "4/5 SSH key for Railway (answer the prompt if it asks to register a key)"
[ -f "$HOME/.ssh/id_ed25519" ] || ssh-keygen -q -t ed25519 -N '' -f "$HOME/.ssh/id_ed25519"
ssh_args=()
[ -z "$SERVICE" ] || ssh_args+=(--service "$SERVICE")
# Trust Railway's SSH host up front (avoids the yes/no prompt, which a Vietnamese
# keyboard can turn into "yé"), then wait for a freshly registered key to activate.
mkdir -p "$HOME/.ssh" && chmod 700 "$HOME/.ssh"
if ! ssh-keygen -F ssh.railway.com >/dev/null 2>&1; then
  ssh-keyscan -t ed25519 ssh.railway.com 2>/dev/null >> "$HOME/.ssh/known_hosts" || true
fi
reachable=0
for attempt in 1 2 3 4 5 6; do
  if railway ssh "${ssh_args[@]}" -- echo "Railway container reachable" </dev/null; then reachable=1; break; fi
  echo "Railway is still activating the SSH key (attempt $attempt/6); retrying in 20s…"
  sleep 20
done
[ "$reachable" = 1 ] || die "Could not open SSH to the Railway container. Run the same command again in a few minutes."

say "5/5 Exporting a consistent snapshot of each database"
mkdir -p "$OUT_DIR"
chmod 700 "$OUT_DIR"
raw="$OUT_DIR/.raw-export.txt"
railway ssh "${ssh_args[@]}" -- node - < "$DEPLOY_DIR/railway-export.js" > "$raw"
node - "$raw" "$OUT_DIR" <<'NODE'
const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')
const [raw, outDir] = process.argv.slice(2)
const lines = fs.readFileSync(raw, 'utf8').split(/\r?\n/)
if (!lines.some((line) => line.trim() === 'MAKOTO_EXPORT_DONE')) { console.error('Export did not finish. Output:\n' + lines.slice(0, 20).join('\n')); process.exit(1) }
let ok = 0
let problems = 0
for (const line of lines) {
  const trimmed = line.trim()
  if (!trimmed.startsWith('MAKOTO_EXPORT {')) continue
  const record = JSON.parse(trimmed.slice('MAKOTO_EXPORT '.length))
  if (record.missing && record.optional) { console.log(`none     ${record.name} (not created yet on Railway; nothing to copy)`); continue }
  if (record.missing) { console.log(`missing  ${record.name} (searched: ${record.searched.join(', ')})`); problems++; continue }
  if (record.error) { console.log(`error    ${record.name}: ${record.error}`); problems++; continue }
  const data = Buffer.from(record.data, 'base64')
  const sha = crypto.createHash('sha256').update(data).digest('hex')
  if (sha !== record.sha256 || data.length !== record.bytes) { console.log(`corrupt  ${record.name} (checksum mismatch)`); problems++; continue }
  if (record.integrity !== 'ok') { console.log(`corrupt  ${record.name} (integrity_check: ${record.integrity})`); problems++; continue }
  fs.writeFileSync(path.join(outDir, `${record.name}.sqlite`), data, { mode: 0o600 })
  console.log(`ok       ${record.name}  ${(data.length / 1024).toFixed(1)} KB  from ${record.source}`)
  ok++
}
fs.rmSync(raw, { force: true })
if (!ok) process.exit(1)
if (problems) console.log('\nSome databases were not exported; import the rest with ALLOW_PARTIAL=1 only if that is expected.')
NODE

echo
echo "Saved to: $OUT_DIR"
echo "Next:     sudo makoto-import-data $OUT_DIR"
