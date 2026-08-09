#!/usr/bin/env bash
# Pull the latest DrivePro and restart the service.
# Usage: sudo bash /opt/drivepro/repo/deploy/update.sh
set -euo pipefail
sudo -u drivepro git -C /opt/drivepro/repo pull --ff-only

# Backfill env keys added after this VM was first provisioned. Existing values
# are never touched - setup-oci.sh only writes /etc/drivepro.env when absent.
ENV_FILE=/etc/drivepro.env
if [ -f "$ENV_FILE" ]; then
  grep -q '^NODE_ENV=' "$ENV_FILE" || printf 'NODE_ENV=production\n' >> "$ENV_FILE"
  grep -q '^OTP_ECHO=' "$ENV_FILE" || cat >> "$ENV_FILE" <<'EOF'
# TEMPORARY - no SMS provider is wired yet (roadmap L24), so verification
# codes are still echoed back to the client. DELETE this line the moment
# real SMS delivery lands: with NODE_ENV=production the echo is off by
# default, which is the only safe setting for real users.
OTP_ECHO=1
EOF
fi

systemctl restart drivepro
sleep 1
curl -fsS http://localhost:4000/api/health && echo " <- updated & healthy"
