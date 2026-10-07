#!/usr/bin/env bash
# Pull the latest DrivePro and restart the service.
# Usage: sudo bash /opt/drivepro/repo/deploy/update.sh
set -euo pipefail
sudo -u drivepro git -C /opt/drivepro/repo pull --ff-only

# Backfill NODE_ENV on older VMs. Existing values are never changed.
ENV_FILE=/etc/drivepro.env
if [ -f "$ENV_FILE" ]; then
  grep -q '^NODE_ENV=' "$ENV_FILE" || printf 'NODE_ENV=production\n' >> "$ENV_FILE"
fi

# Backups, watchdog and automatic security patching. Idempotent, and running
# it here means a VM provisioned before any of it existed gets it on its next
# deploy rather than when somebody remembers.
bash /opt/drivepro/repo/deploy/setup-ops.sh || echo "warning: ops units not installed" >&2

systemctl restart drivepro

# Health check with a grace window: on a loaded box (the OSRM graph build,
# a swap-heavy moment) node can take longer than a second to listen, and a
# deploy that actually succeeded should not turn CI red over boot time.
for i in $(seq 1 30); do
  if curl -fsS http://localhost:4000/api/health 2>/dev/null; then
    echo " <- updated & healthy (after ${i} tries)"
    exit 0
  fi
  sleep 2
done
echo "service did not become healthy within 60s" >&2
journalctl -u drivepro -n 20 --no-pager >&2 || true
exit 1
