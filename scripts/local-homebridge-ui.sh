#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TEST_DIR="${HOMEBRIDGE_LAMETRIC_TEST_DIR:-"$ROOT_DIR/.local-homebridge-test"}"
RUNTIME_DIR="$TEST_DIR/runtime"
HB_DIR="$TEST_DIR/hb"
PACK_DIR="$TEST_DIR/packs"
UI_PORT="${HOMEBRIDGE_UI_PORT:-8581}"

mkdir -p "$RUNTIME_DIR" "$HB_DIR" "$PACK_DIR"

cd "$ROOT_DIR"

echo "Building homebridge-lametric..."
npm run build

echo "Packing local plugin..."
rm -f "$PACK_DIR"/homebridge-lametric-*.tgz
PACK_FILE="$(npm pack --pack-destination "$PACK_DIR" --silent | tail -n 1)"
TARBALL="$PACK_DIR/$PACK_FILE"

if [ ! -f "$TARBALL" ]; then
  echo "Could not create package tarball: $TARBALL" >&2
  exit 1
fi

if [ ! -f "$RUNTIME_DIR/package.json" ]; then
  npm init --yes --prefix "$RUNTIME_DIR" >/dev/null
fi

echo "Installing Homebridge, Homebridge UI, and local plugin..."
npm install \
  --prefix "$RUNTIME_DIR" \
  --no-audit \
  --no-fund \
  "homebridge@^2.0.0-beta.0" \
  "homebridge-config-ui-x@latest" \
  "$TARBALL"

CONFIG_FILE="$HB_DIR/config.json"
if [ ! -f "$CONFIG_FILE" ]; then
  cat > "$CONFIG_FILE" <<JSON
{
  "bridge": {
    "name": "Homebridge LaMetric Test",
    "username": "0E:57:00:00:11:00",
    "port": 51100,
    "pin": "031-45-154"
  },
  "accessories": [],
  "platforms": [
    {
      "platform": "config",
      "name": "Config",
      "port": $UI_PORT,
      "auth": "none",
      "theme": "auto",
      "tempUnits": "c"
    }
  ]
}
JSON
fi

node - "$CONFIG_FILE" "$UI_PORT" <<'NODE'
const fs = require('fs');

const [configFile, uiPort] = process.argv.slice(2);
const config = JSON.parse(fs.readFileSync(configFile, 'utf8'));
config.platforms = Array.isArray(config.platforms) ? config.platforms : [];

let uiPlatform = config.platforms.find(platform => platform?.platform === 'config');
if (!uiPlatform) {
  uiPlatform = {
    platform: 'config',
    name: 'Config',
    auth: 'none',
    theme: 'auto',
    tempUnits: 'c',
  };
  config.platforms.unshift(uiPlatform);
}

uiPlatform.port = Number(uiPort);
fs.writeFileSync(configFile, `${JSON.stringify(config, null, 2)}\n`);
NODE

AUTH_FILE="$HB_DIR/auth.json"
if [ ! -f "$AUTH_FILE" ]; then
  cat > "$AUTH_FILE" <<'JSON'
[
  {
    "id": 1,
    "username": "admin",
    "name": "Administrator",
    "hashedPassword": "",
    "salt": "",
    "admin": true
  }
]
JSON
fi

echo
echo "Homebridge storage: $HB_DIR"
echo "Plugin path:        $RUNTIME_DIR/node_modules"
echo "Web UI:             http://localhost:$UI_PORT"
echo
echo "Starting Homebridge with UI. Press Ctrl+C to stop."
echo

exec "$RUNTIME_DIR/node_modules/.bin/hb-service" run \
  -U "$HB_DIR" \
  -P "$RUNTIME_DIR/node_modules" \
  --strict-plugin-resolution \
  --stdout
