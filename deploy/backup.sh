#!/usr/bin/env bash
# Back up everything DrivePro cannot regenerate.
#
# /opt/drivepro/data is the whole of it: the SQLite database, the JWT secret
# and the VAPID push keys. Losing the JWT secret signs every session out;
# losing the VAPID keys silently breaks every existing push subscription,
# because browsers hold the old public key. Restoring this one folder onto a
# fresh VM brings back every account, ride, streak, crew and subscription.
#
# Run by drivepro-backup.timer nightly; safe to run by hand at any time.
# Usage: sudo bash /opt/drivepro/repo/deploy/backup.sh
set -euo pipefail

DATA_DIR=${DATA_DIR:-/opt/drivepro/data}
BACKUP_DIR=${BACKUP_DIR:-/opt/drivepro/backups}
KEEP=${KEEP:-14}

if [ ! -d "$DATA_DIR" ]; then
  echo "backup: no data directory at $DATA_DIR" >&2
  exit 1
fi

mkdir -p "$BACKUP_DIR"
chmod 700 "$BACKUP_DIR"

STAMP=$(date -u +%Y%m%d-%H%M%S)
OUT="$BACKUP_DIR/drivepro-$STAMP.tgz"

# SQLite is being written to while this runs. `.backup` takes a consistent
# snapshot through the database's own locking, which a plain file copy does
# not - a copied SQLite file can land mid-transaction and restore corrupt.
# Everything else in the folder is small and static enough to copy directly.
WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT
cp -a "$DATA_DIR/." "$WORK/"
DB="$DATA_DIR/drivepro.db"
if [ -f "$DB" ] && command -v sqlite3 >/dev/null 2>&1; then
  rm -f "$WORK/drivepro.db" "$WORK/drivepro.db-wal" "$WORK/drivepro.db-shm"
  sqlite3 "$DB" ".backup '$WORK/drivepro.db'"
fi

tar czf "$OUT" -C "$WORK" .
chmod 600 "$OUT"

# Verify rather than assume: a backup that cannot be read is not a backup, and
# the moment to find that out is now, not during a restore.
if ! tar tzf "$OUT" >/dev/null 2>&1; then
  echo "backup: $OUT is unreadable, removing it" >&2
  rm -f "$OUT"
  exit 1
fi

# Retention: keep the newest $KEEP, delete the rest. Each is ~300 KB, so this
# is about tidiness, not space.
ls -1t "$BACKUP_DIR"/drivepro-*.tgz 2>/dev/null | tail -n +$((KEEP + 1)) | while read -r old; do
  rm -f "$old"
done

COUNT=$(ls -1 "$BACKUP_DIR"/drivepro-*.tgz 2>/dev/null | wc -l)
echo "backup: wrote $OUT ($(du -h "$OUT" | cut -f1)), $COUNT kept"
