#!/usr/bin/env bash
# DrivePro one-command launcher: server + public tunnel, link on your clipboard.
# Usage: ./start.sh   (Ctrl+C stops everything)
set -e
DIR="$(cd "$(dirname "$0")" && pwd)"
SLOG=/tmp/drivepro-server.log
TLOG=/tmp/drivepro-tunnel.log

command -v cloudflared >/dev/null || { echo "cloudflared missing - run: brew install cloudflared"; exit 1; }

# Restart cleanly if something is already running.
pkill -f "node .*server/src/index.js" 2>/dev/null || true
pkill -f "cloudflared tunnel" 2>/dev/null || true
sleep 1

[ -f "$DIR/app/dist/index.html" ] || echo "note: web app not built yet - run: cd app && npx expo export -p web && node tools/postexport.mjs"

node "$DIR/server/src/index.js" > "$SLOG" 2>&1 &
SERVER_PID=$!
cloudflared tunnel --url http://localhost:4000 > "$TLOG" 2>&1 &
TUNNEL_PID=$!
cleanup() { kill "$SERVER_PID" "$TUNNEL_PID" 2>/dev/null || true; }
trap cleanup EXIT INT TERM

# Wait for the server to answer...
ok=""
for _ in $(seq 1 30); do
  if curl -sf http://localhost:4000/api/health 2>/dev/null | grep -q '"ok":true'; then ok=1; break; fi
  sleep 0.5
done
[ -n "$ok" ] || { echo "server did not start - see $SLOG"; exit 1; }

# ...and for the tunnel URL.
URL=""
for _ in $(seq 1 40); do
  URL="$(grep -oE 'https://[a-z0-9-]+\.trycloudflare\.com' "$TLOG" | head -1 || true)"
  [ -n "$URL" ] && break
  sleep 1
done
[ -n "$URL" ] || { echo "no tunnel URL - see $TLOG"; exit 1; }

printf '%s' "$URL" | pbcopy 2>/dev/null && CLIP=" (copied to clipboard)" || CLIP=""

echo ""
echo "==================================================="
echo "  DrivePro is live:"
echo "  $URL$CLIP"
echo "==================================================="
echo "  Send the link. Ctrl+C stops server + tunnel."
echo ""
wait
