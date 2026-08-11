#!/usr/bin/env bash
# Notice when DrivePro is in trouble, and say so somewhere a person will see.
#
# There is no monitoring service here and no budget for one, but there is
# already a Telegram bot that reaches the person who runs this - the same one
# that delivers verification codes. So the alert channel costs nothing new:
# set ALERT_TELEGRAM_CHAT_ID in /etc/drivepro.env and failures arrive as a
# message. Without it this still runs and still logs to the journal; it just
# has nobody to tell.
#
# Checked here: the service answers, the disk has room, and last night's
# backup actually happened. Anything that would leave the app broken or
# unrecoverable without anyone noticing.
#
# Run by drivepro-watchdog.timer; safe to run by hand.
# Usage: sudo bash /opt/drivepro/repo/deploy/watchdog.sh
set -uo pipefail

ENV_FILE=${ENV_FILE:-/etc/drivepro.env}
STATE_FILE=${STATE_FILE:-/var/lib/drivepro-watchdog.state}
BACKUP_DIR=${BACKUP_DIR:-/opt/drivepro/backups}
HEALTH_URL=${HEALTH_URL:-http://localhost:4000/api/health}
DISK_PCT_MAX=${DISK_PCT_MAX:-85}
BACKUP_MAX_AGE_H=${BACKUP_MAX_AGE_H:-48}

# shellcheck disable=SC1090
[ -f "$ENV_FILE" ] && . "$ENV_FILE"

problems=()

# --- the service answers ---
if ! curl -fsS --max-time 10 "$HEALTH_URL" >/dev/null 2>&1; then
  # One missed check during a deploy restart is noise, not news.
  sleep 15
  if ! curl -fsS --max-time 10 "$HEALTH_URL" >/dev/null 2>&1; then
    active=$(systemctl is-active drivepro 2>/dev/null)
    problems+=("the service is not answering $HEALTH_URL (systemd says: $active)")
  fi
fi

# --- the disk has room ---
pct=$(df --output=pcent / 2>/dev/null | tail -1 | tr -dc '0-9')
if [ -n "$pct" ] && [ "$pct" -ge "$DISK_PCT_MAX" ]; then
  problems+=("the disk is ${pct}% full")
fi

# --- last night's backup happened ---
newest=$(ls -1t "$BACKUP_DIR"/drivepro-*.tgz 2>/dev/null | head -1)
if [ -z "$newest" ]; then
  problems+=("there are no backups in $BACKUP_DIR")
else
  age_h=$(( ( $(date +%s) - $(stat -c %Y "$newest") ) / 3600 ))
  if [ "$age_h" -ge "$BACKUP_MAX_AGE_H" ]; then
    problems+=("the newest backup is ${age_h}h old ($(basename "$newest"))")
  fi
fi

# --- report, but only when something changed ---
#
# A watchdog that repeats itself every five minutes teaches people to ignore
# it. This sends one message when things break and one when they recover.
now_state="ok"
[ ${#problems[@]} -gt 0 ] && now_state="bad"
was_state=$(cat "$STATE_FILE" 2>/dev/null || echo "ok")

notify() {
  local text="$1"
  echo "watchdog: $text"
  if [ -n "${TELEGRAM_BOT_TOKEN:-}" ] && [ -n "${ALERT_TELEGRAM_CHAT_ID:-}" ]; then
    curl -fsS --max-time 15 -X POST \
      "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage" \
      --data-urlencode "chat_id=${ALERT_TELEGRAM_CHAT_ID}" \
      --data-urlencode "text=${text}" >/dev/null 2>&1 \
      || echo "watchdog: could not reach Telegram to send the alert" >&2
  fi
}

if [ "$now_state" = "bad" ]; then
  if [ "$was_state" != "bad" ]; then
    notify "DrivePro needs attention on $(hostname):"$'\n'"- $(printf '%s\n- ' "${problems[@]}" | sed '$ s/- $//')"
  else
    echo "watchdog: still failing (${#problems[@]} problems), already reported"
  fi
else
  [ "$was_state" = "bad" ] && notify "DrivePro is back to normal on $(hostname)."
  echo "watchdog: all clear"
fi

mkdir -p "$(dirname "$STATE_FILE")"
echo "$now_state" > "$STATE_FILE"
exit 0
