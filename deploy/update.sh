#!/usr/bin/env bash
# Pull the latest DrivePro and restart the service.
# Usage: sudo bash /opt/drivepro/repo/deploy/update.sh
set -euo pipefail
sudo -u drivepro git -C /opt/drivepro/repo pull --ff-only
systemctl restart drivepro
sleep 1
curl -fsS http://localhost:4000/api/health && echo " <- updated & healthy"
