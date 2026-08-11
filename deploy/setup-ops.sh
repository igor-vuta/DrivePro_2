#!/usr/bin/env bash
# Install the unattended half of running DrivePro: nightly backups, a
# watchdog, and automatic security patching.
#
# Idempotent - update.sh runs this on every deploy, so the units stay in step
# with the repo and a VM provisioned before any of this existed picks it up on
# its next deploy without anyone remembering to.
#
# Usage: sudo bash /opt/drivepro/repo/deploy/setup-ops.sh
set -euo pipefail

REPO=${REPO:-/opt/drivepro/repo}

# sqlite3 gives backup.sh a consistent snapshot of a database being written to.
# Without it the backup still runs, just with a plain file copy.
if ! command -v sqlite3 >/dev/null 2>&1; then
  apt-get install -y -qq sqlite3 >/dev/null 2>&1 || echo "note: could not install sqlite3; backups will copy the db file instead"
fi

install_unit() {
  local name="$1" body="$2"
  local path="/etc/systemd/system/$name"
  if [ ! -f "$path" ] || ! printf '%s' "$body" | cmp -s - "$path"; then
    printf '%s' "$body" > "$path"
    echo "wrote $path"
  fi
}

install_unit drivepro-backup.service "[Unit]
Description=DrivePro nightly backup
After=drivepro.service

[Service]
Type=oneshot
ExecStart=/usr/bin/env bash $REPO/deploy/backup.sh
"

# 03:20 UTC is roughly 09:20 in Almaty - after the night is over and before
# the morning commute, which is when this app is least likely to be mid-ride.
install_unit drivepro-backup.timer "[Unit]
Description=Run the DrivePro backup nightly

[Timer]
OnCalendar=*-*-* 03:20:00
RandomizedDelaySec=600
Persistent=true

[Install]
WantedBy=timers.target
"

install_unit drivepro-watchdog.service "[Unit]
Description=DrivePro health watchdog

[Service]
Type=oneshot
ExecStart=/usr/bin/env bash $REPO/deploy/watchdog.sh
"

install_unit drivepro-watchdog.timer "[Unit]
Description=Check DrivePro health every 10 minutes

[Timer]
OnBootSec=5min
OnUnitActiveSec=10min

[Install]
WantedBy=timers.target
"

# Security updates applied on their own. The package is present on Ubuntu by
# default but does nothing until it is enabled, which is the state this VM was
# found in - installed, and never once running.
if [ -d /etc/apt/apt.conf.d ]; then
  cat > /etc/apt/apt.conf.d/20auto-upgrades <<'EOF'
APT::Periodic::Update-Package-Lists "1";
APT::Periodic::Unattended-Upgrade "1";
APT::Periodic::AutocleanInterval "7";
EOF
  # Deliberately not enabling automatic reboots: a kernel update needs one,
  # and an unattended reboot of the only production machine, at an hour
  # nobody is watching, is a worse outcome than a few days of a pending
  # restart. The watchdog notices if it does not come back; a person should
  # choose the moment.
  echo "unattended-upgrades enabled (security only, no automatic reboot)"
fi

systemctl daemon-reload
systemctl enable --now drivepro-backup.timer drivepro-watchdog.timer >/dev/null
echo "ops units installed:"
systemctl list-timers --no-pager 'drivepro-*' | head -4
