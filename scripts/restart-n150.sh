#!/bin/bash
set -euo pipefail
DIR="$HOME/wefood"
DEPS="$HOME/wefood-deps"
NODE_ROOT="$HOME/.local/wefood-node-v24.19.0"
export PATH="$NODE_ROOT/bin:$PATH"
PORT=4318
LOG=/tmp/wefood.log
exec 9>/tmp/wefood-restart.lock
flock 9
for file in dist/server/index.js dist/server/migrations/001-core.sql dist/web/index.html package.json package-lock.json; do
  test -f "$DIR/$file" || { echo "Incomplete artifact: $file"; exit 1; }
done
test -x "$NODE_ROOT/bin/node" || { echo 'Missing dedicated WeFood Node 24 runtime'; exit 1; }
test "$(node -p 'process.versions.node.split(".")[0]')" = 24
mkdir -p "$DEPS" "$DIR/data"
chmod 700 "$DIR/data"
HASH=$(sha256sum "$DIR/package-lock.json" | cut -d' ' -f1)
if ! test -f "$DEPS/.lock-hash" || test "$(cat "$DEPS/.lock-hash")" != "$HASH"; then
  cp "$DIR/package.json" "$DIR/package-lock.json" "$DEPS/"
  (
    cd "$DEPS"
    npm ci --omit=dev --ignore-scripts --no-audit --no-fund --registry=https://registry.npmmirror.com 9>&-
    npm_config_build_from_source=true npm_config_nodedir="$NODE_ROOT" npm rebuild better-sqlite3 --foreground-scripts 9>&-
    node --input-type=module -e 'import DB from "better-sqlite3"; import sharp from "sharp"; const db=new DB(":memory:"); db.prepare("SELECT 1").get(); db.close(); if(!sharp.versions.vips) process.exit(1);'
  )
  printf '%s\n' "$HASH" > "$DEPS/.lock-hash"
fi
ln -sfn "$DEPS/node_modules" "$DIR/node_modules"
cd "$DIR"
node --input-type=module -e 'import DB from "better-sqlite3"; import sharp from "sharp"; const db=new DB(":memory:"); db.close(); if(!sharp.versions.vips)process.exit(1);'
if test -f "$HOME/.deploy-env"; then . "$HOME/.deploy-env"; fi
if test -f "$DIR/.env"; then set -a; . "$DIR/.env"; set +a; fi
export PORT=4318 HOST=127.0.0.1 DATA_DIR="$DIR/data"
export SECURE_COOKIE=true TRUSTED_ORIGINS=https://wefood.sherlockguo.com
for pid in $(lsof -tiTCP:"$PORT" -sTCP:LISTEN 2>/dev/null || true); do
  test "$(readlink "/proc/$pid/cwd")" = "$DIR" || { echo 'Port belongs to another service; refusing to stop it'; exit 1; }
  kill -TERM "$pid"
  for n in $(seq 1 20); do kill -0 "$pid" 2>/dev/null || break; sleep 1; done
  if kill -0 "$pid" 2>/dev/null; then echo 'Previous process did not stop; refusing forced termination'; exit 1; fi
done
nohup "$NODE_ROOT/bin/node" dist/server/index.js > "$LOG" 2>&1 9>&- &
for n in $(seq 1 30); do
  if curl -fsS --max-time 2 "http://127.0.0.1:$PORT/api/health" >/dev/null; then echo 'WeFood ready on 4318'; exit 0; fi
  sleep 1
done
echo "WeFood failed health check; inspect $LOG locally without exposing credentials"
exit 1
