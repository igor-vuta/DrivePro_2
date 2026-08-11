#!/usr/bin/env bash
# Self-hosted OSRM for DrivePro: car, foot and bike routing for Kazakhstan,
# on the same Oracle VM, with no API key and no rate limits.
#
#   sudo bash /opt/drivepro/repo/deploy/setup-osrm.sh
#
# Idempotent. Downloads the Kazakhstan extract once, builds the three
# profiles, and runs each as a systemd-managed Docker container on a local
# port. Then it appends the OSRM_*_URL vars to /etc/drivepro.env and restarts
# DrivePro so geo.js uses them.
#
# Building the profiles is memory-hungry - the contraction phase can need more
# RAM than a 1 OCPU / 6 GB instance has free - so this ensures swap first.
set -euo pipefail

REGION_URL="${OSRM_REGION_URL:-https://download.geofabrik.de/asia/kazakhstan-latest.osm.pbf}"
OSRM_DIR="${OSRM_DIR:-/opt/osrm}"
ENV_FILE="${ENV_FILE:-/etc/drivepro.env}"
PBF="$OSRM_DIR/region.osm.pbf"
CAR_PORT=5000
FOOT_PORT=5001
BIKE_PORT=5002
OSRM_IMAGE="ghcr.io/project-osrm/osrm-backend:latest"

echo "==> prerequisites"
if ! command -v docker >/dev/null; then
  echo "installing docker..."
  curl -fsSL https://get.docker.com | sh
fi
systemctl enable --now docker

echo "==> swap (contraction needs more RAM than a small VM has free)"
if [ ! -f /swapfile ] && [ "$(free -m | awk '/Swap:/{print $2}')" -lt 2048 ]; then
  fallocate -l 4G /swapfile || dd if=/dev/zero of=/swapfile bs=1M count=4096
  chmod 600 /swapfile
  mkswap /swapfile
  swapon /swapfile
  grep -q '/swapfile' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
fi

mkdir -p "$OSRM_DIR"
cd "$OSRM_DIR"

echo "==> map data"
if [ ! -f "$PBF" ]; then
  curl -fSL "$REGION_URL" -o "$PBF"
fi

# Build one profile: extract with the given Lua profile, then partition +
# customize (the MLD pipeline, lighter on RAM than contraction-hierarchies).
build_profile() {
  local name="$1" lua="$2"
  local base="$OSRM_DIR/$name"
  if [ -f "$base.osrm.mldgr" ]; then
    echo "    $name already built"
    return
  fi
  echo "    building $name ($lua)"
  cp "$PBF" "$base.osm.pbf"
  docker run --rm -v "$OSRM_DIR:/data" "$OSRM_IMAGE" \
    osrm-extract -p "/opt/$lua.lua" "/data/$name.osm.pbf"
  docker run --rm -v "$OSRM_DIR:/data" "$OSRM_IMAGE" osrm-partition "/data/$name.osrm"
  docker run --rm -v "$OSRM_DIR:/data" "$OSRM_IMAGE" osrm-customize "/data/$name.osrm"
  rm -f "$base.osm.pbf"
}

echo "==> building profiles (this can take a while)"
build_profile car car
build_profile foot foot
build_profile bike bicycle

# A systemd unit per routed profile, each serving one container with MLD.
run_profile() {
  local name="$1" port="$2"
  cat > "/etc/systemd/system/osrm-$name.service" <<EOF
[Unit]
Description=OSRM $name router
After=docker.service
Requires=docker.service

[Service]
Restart=always
ExecStartPre=-/usr/bin/docker rm -f osrm-$name
ExecStart=/usr/bin/docker run --rm --name osrm-$name -p 127.0.0.1:$port:5000 \\
  -v $OSRM_DIR:/data $OSRM_IMAGE \\
  osrm-routed --algorithm mld /data/$name.osrm
ExecStop=/usr/bin/docker stop osrm-$name

[Install]
WantedBy=multi-user.target
EOF
  systemctl daemon-reload
  systemctl enable --now "osrm-$name"
}

echo "==> services"
run_profile car "$CAR_PORT"
run_profile foot "$FOOT_PORT"
run_profile bike "$BIKE_PORT"

echo "==> wiring DrivePro to the local routers"
if [ -f "$ENV_FILE" ]; then
  grep -q '^OSRM_URL=' "$ENV_FILE"      || echo "OSRM_URL=http://localhost:$CAR_PORT" >> "$ENV_FILE"
  grep -q '^OSRM_FOOT_URL=' "$ENV_FILE" || echo "OSRM_FOOT_URL=http://localhost:$FOOT_PORT" >> "$ENV_FILE"
  grep -q '^OSRM_BIKE_URL=' "$ENV_FILE" || echo "OSRM_BIKE_URL=http://localhost:$BIKE_PORT" >> "$ENV_FILE"
  systemctl restart drivepro
fi

echo "==> health"
sleep 3
for p in "$CAR_PORT" "$FOOT_PORT" "$BIKE_PORT"; do
  curl -fsS "http://localhost:$p/route/v1/driving/76.89,43.24;76.95,43.26?overview=false" >/dev/null 2>&1 \
    && echo "    port $p OK" || echo "    port $p not answering yet (may still be starting)"
done

cat <<EOF

===================================================
  OSRM is up on 5000 (car) / 5001 (foot) / 5002 (bike)
  DrivePro now routes through them.
  Logs:    journalctl -u osrm-car -f
  Rebuild: sudo bash $0   (after a new region download)
===================================================
EOF
