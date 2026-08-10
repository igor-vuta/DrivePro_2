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
  # Only seeded on a VM that has never had SMS: with a Twilio provider
  # configured the echo turns itself off, so this line should be deleted -
  # see the Environments section of DEPLOY.md.
  grep -q '^OTP_ECHO=' "$ENV_FILE" || grep -q '^TWILIO_ACCOUNT_SID=' "$ENV_FILE" || cat >> "$ENV_FILE" <<'EOF'
# TEMPORARY - no SMS provider configured, so verification codes are echoed
# back to the client and anyone can verify a number they do not own. DELETE
# this line once TWILIO_* is set; the safe default then takes over.
OTP_ECHO=1
EOF
fi

systemctl restart drivepro
sleep 1
curl -fsS http://localhost:4000/api/health && echo " <- updated & healthy"
