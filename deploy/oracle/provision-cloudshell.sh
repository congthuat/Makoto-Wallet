#!/usr/bin/env bash
# Makoto backend — one-command provisioning from Oracle Cloud Shell (already logged in).
#
#   bash <(curl -fsSL https://raw.githubusercontent.com/congthuat/Makoto-Wallet/makoto-wallet/deploy/oracle/provision-cloudshell.sh)
#
# Creates (or reuses) a VCN with ports 22/80/443, an Always Free Ampere A1 VM running
# Ubuntu 24.04, installs the backend automatically via cloud-init, then walks you
# through secrets, DNS, HTTPS and the Railway data copy. Safe to re-run at any time.
set -Eeuo pipefail

NAME="${NAME:-makoto-backend}"
API_DOMAIN="${API_DOMAIN:-api.makotowallet.xyz}"
RAW_BASE="${RAW_BASE:-https://raw.githubusercontent.com/congthuat/Makoto-Wallet/makoto-wallet/deploy/oracle}"
OCPUS="${OCPUS:-2}"
MEMORY_GB="${MEMORY_GB:-12}"
MAX_ATTEMPTS="${MAX_ATTEMPTS:-90}"     # capacity retries, about one per minute
# RSA: Oracle Cloud Shell runs in FIPS mode, where ED25519 keys are not allowed.
SSH_KEY="${SSH_KEY:-$HOME/.ssh/id_rsa}"
STATE_DIR="$HOME/.makoto-oracle"

say() { printf '\n\033[1;36m==> %s\033[0m\n' "$*"; }
info() { printf '    %s\n' "$*"; }
warn() { printf '\033[1;33m[!] %s\033[0m\n' "$*" >&2; }
die() { printf '\033[1;31m[x] %s\033[0m\n' "$*" >&2; exit 1; }
trap 'die "Stopped at line $LINENO. It is safe to run the same command again."' ERR
ask_yes() { local answer=""; read -r -p "$1 [y/N] " answer </dev/tty || true; [[ "$answer" =~ ^[YyCc] ]]; }

command -v oci >/dev/null || die "Run this in Oracle Cloud Shell (the >_ icon at the top of cloud.oracle.com)."
mkdir -p "$STATE_DIR"

say "0/8 Account"
TENANCY="${OCI_TENANCY:-}"
[ -n "$TENANCY" ] || TENANCY="$(awk -F= '/^[[:space:]]*tenancy[[:space:]]*=/{gsub(/[[:space:]]/,"",$2); print $2; exit}' /etc/oci/config "$HOME/.oci/config" 2>/dev/null || true)"
[ -n "$TENANCY" ] || read -r -p "Paste your tenancy OCID (Profile menu → Tenancy → OCID): " TENANCY </dev/tty
[[ "$TENANCY" == ocid1.tenancy.* ]] || die "Tenancy OCID not found"
COMPARTMENT="${COMPARTMENT_ID:-$TENANCY}"
info "Region: ${OCI_REGION:-$(oci iam region-subscription list --query 'data[?"is-home-region"]|[0]."region-name"' --raw-output 2>/dev/null || echo unknown)}"
AD="$(oci iam availability-domain list --compartment-id "$TENANCY" --query 'data[0].name' --raw-output)"
info "Availability domain: $AD"

say "1/8 SSH key"
if [ ! -f "$SSH_KEY" ]; then mkdir -p "$(dirname "$SSH_KEY")"; chmod 700 "$(dirname "$SSH_KEY")"; ssh-keygen -q -t rsa -b 4096 -N '' -f "$SSH_KEY"; fi
[ -f "$SSH_KEY.pub" ] || ssh-keygen -y -f "$SSH_KEY" > "$SSH_KEY.pub"
info "Using $SSH_KEY.pub"

say "2/8 Network (VCN, internet gateway, ports 22/80/443)"
VCN="$(oci network vcn list --compartment-id "$COMPARTMENT" --display-name makoto-vcn --lifecycle-state AVAILABLE --query 'data[0].id' --raw-output 2>/dev/null || true)"
if [ -z "$VCN" ] || [ "$VCN" = "null" ]; then
  VCN="$(oci network vcn create --compartment-id "$COMPARTMENT" --cidr-blocks '["10.0.0.0/16"]' --display-name makoto-vcn --dns-label makotovcn --wait-for-state AVAILABLE --query 'data.id' --raw-output)"
  info "Created VCN"
else info "Reusing VCN"; fi
IGW="$(oci network internet-gateway list --compartment-id "$COMPARTMENT" --vcn-id "$VCN" --query 'data[0].id' --raw-output 2>/dev/null || true)"
if [ -z "$IGW" ] || [ "$IGW" = "null" ]; then
  IGW="$(oci network internet-gateway create --compartment-id "$COMPARTMENT" --vcn-id "$VCN" --is-enabled true --display-name makoto-igw --wait-for-state AVAILABLE --query 'data.id' --raw-output)"
fi
RT="$(oci network vcn get --vcn-id "$VCN" --query 'data."default-route-table-id"' --raw-output)"
SL="$(oci network vcn get --vcn-id "$VCN" --query 'data."default-security-list-id"' --raw-output)"
oci network route-table update --rt-id "$RT" --force \
  --route-rules "[{\"destination\":\"0.0.0.0/0\",\"destinationType\":\"CIDR_BLOCK\",\"networkEntityId\":\"$IGW\"}]" >/dev/null
tcp() { printf '{"source":"0.0.0.0/0","protocol":"6","isStateless":false,"tcpOptions":{"destinationPortRange":{"min":%s,"max":%s}}}' "$1" "$1"; }
oci network security-list update --security-list-id "$SL" --force \
  --ingress-security-rules "[$(tcp 22),$(tcp 80),$(tcp 443),{\"source\":\"0.0.0.0/0\",\"protocol\":\"1\",\"icmpOptions\":{\"type\":3,\"code\":4}},{\"source\":\"10.0.0.0/16\",\"protocol\":\"1\",\"icmpOptions\":{\"type\":3}}]" \
  --egress-security-rules '[{"destination":"0.0.0.0/0","protocol":"all"}]' >/dev/null
SUBNET="$(oci network subnet list --compartment-id "$COMPARTMENT" --vcn-id "$VCN" --display-name makoto-subnet --query 'data[0].id' --raw-output 2>/dev/null || true)"
if [ -z "$SUBNET" ] || [ "$SUBNET" = "null" ]; then
  SUBNET="$(oci network subnet create --compartment-id "$COMPARTMENT" --vcn-id "$VCN" --cidr-block 10.0.0.0/24 --display-name makoto-subnet --dns-label makotosub --prohibit-public-ip-on-vnic false --wait-for-state AVAILABLE --query 'data.id' --raw-output)"
fi
info "Ports 22, 80, 443 open; subnet ready"

say "3/8 Virtual machine (Always Free Ampere A1, Ubuntu 24.04)"
INSTANCE="$(oci compute instance list --compartment-id "$COMPARTMENT" --display-name "$NAME" --query 'data[?"lifecycle-state"!=`TERMINATED` && "lifecycle-state"!=`TERMINATING`] | [0].id' --raw-output 2>/dev/null || true)"
if [ -z "$INSTANCE" ] || [ "$INSTANCE" = "null" ]; then
  IMAGE="$(oci compute image list --compartment-id "$COMPARTMENT" --operating-system "Canonical Ubuntu" --operating-system-version "24.04" --shape VM.Standard.A1.Flex --sort-by TIMECREATED --sort-order DESC --all --query 'data[?!contains("display-name", `Minimal`)] | [0].id' --raw-output)"
  [ -n "$IMAGE" ] && [ "$IMAGE" != "null" ] || die "Ubuntu 24.04 ARM image not found in this region"
  cat > "$STATE_DIR/cloud-init.sh" <<EOF
#!/bin/bash
exec > /var/log/makoto-setup.log 2>&1
for i in \$(seq 1 30); do curl -fsSL "$RAW_BASE/setup.sh" -o /root/makoto-setup.sh && break; sleep 10; done
if API_DOMAIN="$API_DOMAIN" bash /root/makoto-setup.sh; then touch /var/lib/makoto-setup.ok; else touch /var/lib/makoto-setup.failed; fi
EOF
  attempt=1
  while :; do
    ocpus="$OCPUS"; mem="$MEMORY_GB"
    # Alternate with a smaller (still Always Free) size when large hosts are full.
    if [ $((attempt % 2)) -eq 0 ] && [ "$OCPUS" -gt 1 ]; then ocpus=1; mem=6; fi
    info "Attempt $attempt/$MAX_ATTEMPTS: $ocpus OCPU / ${mem} GB"
    if out="$(oci compute instance launch --compartment-id "$COMPARTMENT" --availability-domain "$AD" \
          --shape VM.Standard.A1.Flex --shape-config "{\"ocpus\":$ocpus,\"memoryInGBs\":$mem}" \
          --image-id "$IMAGE" --subnet-id "$SUBNET" --assign-public-ip true --display-name "$NAME" \
          --boot-volume-size-in-gbs 50 --ssh-authorized-keys-file "$SSH_KEY.pub" \
          --user-data-file "$STATE_DIR/cloud-init.sh" --wait-for-state RUNNING --query 'data.id' --raw-output 2>&1)"; then
      INSTANCE="$(printf '%s\n' "$out" | grep -o 'ocid1\.instance[^" ]*' | tail -1)"
      break
    fi
    if printf '%s' "$out" | grep -qiE 'out of (host )?capacity|OutOfCapacity|InternalError'; then
      [ "$attempt" -lt "$MAX_ATTEMPTS" ] || die "Oracle has no free ARM capacity right now. Run the same command again later (or upgrade to Pay As You Go, still \$0)."
      info "Tokyo ARM capacity is full; retrying in 60s (Ctrl+C to stop; re-running later is safe)"
      attempt=$((attempt + 1)); sleep 60; continue
    fi
    printf '%s\n' "$out" | tail -20 >&2
    die "Could not create the VM (see the message above)."
  done
  info "VM created"
else info "Reusing existing VM"; fi
[ -n "$INSTANCE" ] || die "VM id not found"
IP="$(oci compute instance list-vnics --instance-id "$INSTANCE" --query 'data[0]."public-ip"' --raw-output)"
[ -n "$IP" ] && [ "$IP" != "null" ] || die "The VM has no public IP"
echo "$IP" > "$STATE_DIR/ip"
info "Public IP: $IP"
SSH_OPTS=(-i "$SSH_KEY" -o StrictHostKeyChecking=accept-new -o ConnectTimeout=8 -o ServerAliveInterval=30)
remote() { ssh "${SSH_OPTS[@]}" "ubuntu@$IP" "$@"; }
remote_tty() { ssh -t "${SSH_OPTS[@]}" "ubuntu@$IP" "$@"; }

say "4/8 Waiting for the automatic installation (5-10 minutes)"
for _ in $(seq 1 60); do remote true 2>/dev/null && break; sleep 10; done
remote true || die "Cannot SSH to $IP yet. Wait a minute and run the same command again."
for i in $(seq 1 120); do
  if remote 'test -f /var/lib/makoto-setup.ok' 2>/dev/null; then info "Installation finished"; break; fi
  if remote 'test -f /var/lib/makoto-setup.failed' 2>/dev/null; then
    remote 'sudo tail -40 /var/log/makoto-setup.log' || true
    die "Installation failed on the VM (log above). Fix, then: ssh into the VM and run: curl -fsSL $RAW_BASE/setup.sh | sudo bash"
  fi
  [ $((i % 6)) -eq 0 ] && info "still installing… ($(( i / 6 )) min)"
  sleep 10
done
remote 'test -f /var/lib/makoto-setup.ok' || die "Installation is taking unusually long. Run the same command again in a few minutes."

say "5/8 Secrets (copy them from Railway → makoto-backend → Variables → Raw Editor)"
if remote "sudo grep -qE '^[A-Z0-9_]+=CHANGE_ME\\s*\$' /etc/makoto/backend.env"; then
  remote_tty 'sudo makoto-configure'
elif ask_yes "Secrets are already set. Change them?"; then
  remote_tty 'sudo makoto-configure'
fi
remote 'sudo makoto-update --check' >/dev/null || die "Backend is not healthy on the VM. Run: ssh ubuntu@$IP 'sudo journalctl -u makoto-backend -n 60'"
info "Backend healthy on the VM"

say "6/8 DNS: point $API_DOMAIN to $IP"
resolve() { curl -fsS "https://dns.google/resolve?name=$API_DOMAIN&type=A" 2>/dev/null | python3 -c 'import json,sys; print(" ".join(a["data"] for a in json.load(sys.stdin).get("Answer",[]) if a.get("type")==1))' 2>/dev/null || true; }
if [ "$(resolve)" != "$IP" ]; then
  cat <<EOF

    Open https://vercel.com → Domains → makotowallet.xyz → DNS Records → Add:
        Name:  api
        Type:  A
        Value: $IP
    (DNS for makotowallet.xyz is hosted by Vercel, not Spaceship.)
    If an old "api" record exists, delete it first.

EOF
  info "Waiting for DNS (checks every 20s, up to 30 min; Ctrl+C to stop — re-running later is safe)"
  for i in $(seq 1 90); do
    current="$(resolve)"
    [ "$current" = "$IP" ] && break
    [ $((i % 6)) -eq 0 ] && info "DNS now: ${current:-none}"
    sleep 20
  done
  [ "$(resolve)" = "$IP" ] || die "DNS does not point to $IP yet. Add the record, then run the same command again."
fi
info "DNS OK"

say "7/8 HTTPS"
for i in $(seq 1 30); do
  if curl -fsS "https://$API_DOMAIN/api/health" 2>/dev/null | grep -q '"ok"'; then info "https://$API_DOMAIN/api/health is OK"; break; fi
  [ "$i" -eq 3 ] && remote 'sudo systemctl restart caddy' || true
  sleep 10
done
curl -fsS "https://$API_DOMAIN/api/health" | grep -q '"ok"' || die "HTTPS is not ready yet. Run the same command again in a few minutes (log: ssh ubuntu@$IP 'sudo journalctl -u caddy -n 50')."

say "8/8 Copy data from Railway"
if ask_yes "Copy Tasks, portfolio history and wallet sessions from Railway now?"; then
  remote_tty 'makoto-railway-export'
  remote_tty 'latest="$(ls -dt "$HOME"/railway-export-* 2>/dev/null | head -1)"; [ -n "$latest" ] && sudo makoto-import-data "$latest"'
else
  info "Skipped. Later run this same command again, or: ssh ubuntu@$IP makoto-railway-export"
fi

say "Done"
cat <<EOF
    Backend:  https://$API_DOMAIN  (VM $IP, Oracle Always Free)
    SSH:      ssh ubuntu@$IP
    Next:     tell Makoto Agent "Oracle xong" to switch makotowallet.xyz from Railway to Oracle.
EOF
