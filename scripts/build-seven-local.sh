#!/usr/bin/env bash
set -euo pipefail

# ============================================================
# tokenicode-7 (seven edition) — personal frozen build
#
# Identity com.tinyzhuang.tokenicode-7, updater disabled
# (dead endpoint + no updater artifacts). Builds an aarch64
# .app, then a plain DMG via hdiutil (tauri's dmg bundler is
# flaky in some local environments). Local use only — never
# uploads anywhere.
#
# Usage:
#   ./scripts/build-seven-local.sh
#   npm run build:7
# ============================================================

PROJECT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$PROJECT_DIR"

VERSION=$(python3 -c "import json; print(json.load(open('package.json'))['version'])")
TARGET="aarch64-apple-darwin"
BUNDLE_DIR="src-tauri/target/$TARGET/release/bundle"

echo "============================================"
echo " tokenicode-7 local build  v$VERSION  ($TARGET)"
echo "============================================"

echo ""
echo "[1/3] Building .app..."
EDITION=seven npx tauri build --target "$TARGET" --bundles app \
  --config editions/seven/tauri.seven.conf.json

APP_PATH="$BUNDLE_DIR/macos/tokenicode-7.app"
[ -d "$APP_PATH" ] || { echo "ERROR: $APP_PATH not found"; exit 1; }

echo ""
echo "[2/3] Verifying frozen identity..."
BUNDLE_ID=$(plutil -extract CFBundleIdentifier raw "$APP_PATH/Contents/Info.plist")
if [ "$BUNDLE_ID" != "com.tinyzhuang.tokenicode-7" ]; then
  echo "ERROR: unexpected bundle id: $BUNDLE_ID (config override did not apply)"
  exit 1
fi
echo "  CFBundleIdentifier = $BUNDLE_ID"

echo ""
echo "[3/3] Creating DMG via hdiutil..."
DMG_PATH="$BUNDLE_DIR/dmg/tokenicode-7_${VERSION}_aarch64.dmg"
mkdir -p "$(dirname "$DMG_PATH")"
STAGING=$(mktemp -d)
cp -R "$APP_PATH" "$STAGING/"
ln -s /Applications "$STAGING/Applications"
rm -f "$DMG_PATH"
hdiutil create -volname "tokenicode-7" -srcfolder "$STAGING" -ov -format UDZO "$DMG_PATH"
rm -rf "$STAGING"

echo ""
echo "============================================"
echo " Done."
echo "   App: $APP_PATH"
echo "   DMG: $DMG_PATH"
echo ""
echo " Install: open the DMG and drag tokenicode-7"
echo " into /Applications (replace the old copy)."
echo "============================================"
