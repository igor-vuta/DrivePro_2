#!/usr/bin/env bash
# DrivePro one-script host setup for an Oracle Cloud VM (Ubuntu 22.04/24.04,
# ARM or x86). Installs Node 22 + Caddy, opens the instance firewall, clones
# the repo, and wires systemd + HTTPS. Idempotent - safe to re-run.
#
#   sudo DOMAIN=you.duckdns.org [DUCKDNS_TOKEN=xxx] bash deploy/setup-oci.sh
#
# Also allow ingress TCP 80 + 443 in the OCI Security List / NSG (web console)
# - the script can only open the firewall inside the VM.
set -euo pipefail

DOMAIN="${DOMAIN:?Set DOMAIN, e.g.: sudo DOMAIN=you.duckdns.org bash deploy/setup-oci.sh}"
REPO_URL="${REPO_URL:-https://github.com/igor-vuta/DrivePro_2.git}"
APP_DIR=/opt/drivepro
REPO_DIR="$APP_DIR/repo"
DATA_DIR="$APP_DIR/data"
ENV_FILE=/etc/drivepro.env

[ "$(id -u)" = 0 ] || { echo "run with sudo"; exit 1; }
export DEBIAN_FRONTEND=noninteractive

echo "==> base packages"
apt-get update -y
apt-get install -y curl git ca-certificates gnupg

echo "==> Node 22 (node:sqlite needs >= 22.5)"
if ! command -v node >/dev/null 2>&1 || [ "$(node -p 'Number(process.versions.node.split(".")[0])')" -lt 22 ]; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt-get install -y nodejs
fi
node --version

echo "==> Caddy (automatic HTTPS)"
if ! command -v caddy >/dev/null 2>&1; then
  apt-get install -y debian-keyring debian-archive-keyring apt-transport-https
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' \
    | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' \
    > /etc/apt/sources.list.d/caddy-stable.list
  apt-get update -y
  apt-get install -y caddy
fi

echo "==> open 80/443 inside the VM (OCI Ubuntu images ship a restrictive iptables)"
for p in 80 443; do
  iptables -C INPUT -p tcp --dport "$p" -j ACCEPT 2>/dev/null \
    || iptables -I INPUT 1 -p tcp --dport "$p" -j ACCEPT
done
command -v netfilter-persistent >/dev/null 2>&1 && netfilter-persistent save || true

echo "==> app user + repo at $REPO_DIR"
id -u drivepro >/dev/null 2>&1 || useradd -r -m -d "$APP_DIR" -s /usr/sbin/nologin drivepro
mkdir -p "$APP_DIR" "$DATA_DIR"
chown -R drivepro:drivepro "$APP_DIR"
if [ -d "$REPO_DIR/.git" ]; then
  sudo -u drivepro git -C "$REPO_DIR" pull --ff-only
else
  sudo -u drivepro git clone "$REPO_URL" "$REPO_DIR"
fi

echo "==> environment ($ENV_FILE)"
if [ ! -f "$ENV_FILE" ]; then
  cat > "$ENV_FILE" <<EOF
PORT=4000
DATA_DIR=$DATA_DIR
ADMIN_TOKEN=$(head -c 24 /dev/urandom | base64 | tr -d '+/=')
EOF
  chmod 600 "$ENV_FILE"
fi

echo "==> systemd service"
install -m 644 "$REPO_DIR/deploy/drivepro.service" /etc/systemd/system/drivepro.service
systemctl daemon-reload
systemctl enable --now drivepro

echo "==> Caddy vhost for $DOMAIN"
sed "s/{{DOMAIN}}/$DOMAIN/" "$REPO_DIR/deploy/Caddyfile" > /etc/caddy/Caddyfile
systemctl enable caddy >/dev/null 2>&1 || true
systemctl reload caddy 2>/dev/null || systemctl restart caddy

if [ -n "${DUCKDNS_TOKEN:-}" ]; then
  echo "==> DuckDNS auto-refresh every 5 minutes"
  SUB="${DOMAIN%%.duckdns.org}"
  cat > /etc/cron.d/duckdns <<EOF
*/5 * * * * root curl -fsS "https://www.duckdns.org/update?domains=$SUB&token=$DUCKDNS_TOKEN&ip=" >/dev/null 2>&1
EOF
fi

sleep 2
echo "==> health check"
curl -fsS http://localhost:4000/api/health && echo
cat <<EOF

===================================================
  DrivePro is up:   https://$DOMAIN
  Admin token:      sudo grep ADMIN_TOKEN $ENV_FILE
  Server logs:      journalctl -u drivepro -f
  Update later:     sudo bash $REPO_DIR/deploy/update.sh
===================================================
EOF
