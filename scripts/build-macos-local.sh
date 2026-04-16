#!/usr/bin/env bash
set -euo pipefail

# ============================================================
# TOKENICODE / TCAlpha macOS Local Build Script
# Builds, signs, notarizes for both aarch64 and x86_64
# Then uploads artifacts to the existing GitHub Draft Release
#
# Usage:
#   ./scripts/build-macos-local.sh              # stable (TOKENICODE)
#   EDITION=alpha ./scripts/build-macos-local.sh # alpha  (TCAlpha)
# ============================================================

PROJECT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$PROJECT_DIR"

EDITION="${EDITION:-stable}"
VERSION=$(python3 -c "import json; print(json.load(open('package.json'))['version'])")

if [ "$EDITION" = "alpha" ]; then
  TAG="v$VERSION-alpha"
  PRODUCT_NAME="TCAlpha"
  TAURI_EXTRA_ARGS="--config editions/alpha/tauri.alpha.conf.json"
else
  TAG="v$VERSION"
  PRODUCT_NAME="TOKENICODE"
  TAURI_EXTRA_ARGS=""
fi

echo "============================================"
echo " $PRODUCT_NAME macOS Local Build"
echo " Edition: $EDITION  Version: $VERSION  Tag: $TAG"
echo "============================================"

# --- Environment Variables ---
# Required env vars — set in shell profile, .env file, or export before running.
# See .env.example for the full list.
#
#   APPLE_SIGNING_IDENTITY       e.g. "Developer ID Application: Name (TEAMID)"
#   APPLE_ID                     Your Apple ID email
#   APPLE_PASSWORD               App-specific password (appleid.apple.com → Security)
#   APPLE_TEAM_ID                10-char Apple Developer Team ID
#   TAURI_SIGNING_PRIVATE_KEY_PASSWORD  Tauri updater signing key passphrase

# Load .env if present (ignored by git)
[ -f "$PROJECT_DIR/.env" ] && set -a && source "$PROJECT_DIR/.env" && set +a

: "${APPLE_SIGNING_IDENTITY:?Set APPLE_SIGNING_IDENTITY in .env or environment}"
: "${APPLE_ID:?Set APPLE_ID in .env or environment}"
: "${APPLE_PASSWORD:?Set APPLE_PASSWORD in .env or environment}"
: "${APPLE_TEAM_ID:?Set APPLE_TEAM_ID in .env or environment}"
: "${TAURI_SIGNING_PRIVATE_KEY_PASSWORD:?Set TAURI_SIGNING_PRIVATE_KEY_PASSWORD in .env or environment}"

export APPLE_SIGNING_IDENTITY APPLE_ID APPLE_PASSWORD APPLE_TEAM_ID
export TAURI_SIGNING_PRIVATE_KEY
TAURI_SIGNING_PRIVATE_KEY="$(cat "$HOME/.tauri/tokenicode.key")"
export TAURI_SIGNING_PRIVATE_KEY_PASSWORD
export EDITION

# --- Preflight Checks ---
echo ""
echo "[1/6] Preflight checks..."
command -v pnpm >/dev/null || { echo "ERROR: pnpm not found"; exit 1; }
command -v cargo >/dev/null || { echo "ERROR: cargo not found"; exit 1; }
command -v xcrun >/dev/null || { echo "ERROR: xcrun not found"; exit 1; }
rustup target list --installed | grep -q aarch64-apple-darwin || { echo "ERROR: aarch64 target missing"; exit 1; }
rustup target list --installed | grep -q x86_64-apple-darwin || { echo "ERROR: x86_64 target missing"; exit 1; }
security find-identity -v -p codesigning | grep -q "Developer ID Application" || { echo "ERROR: No Developer ID cert in Keychain"; exit 1; }
echo "  All checks passed."

# --- Install Dependencies ---
echo ""
echo "[2/6] Installing dependencies..."
pnpm install --frozen-lockfile

# --- Build aarch64 ---
echo ""
echo "[3/6] Building aarch64-apple-darwin (Apple Silicon)..."
pnpm tauri build --target aarch64-apple-darwin $TAURI_EXTRA_ARGS 2>&1 | tee /tmp/tauri-build-aarch64.log
echo "  aarch64 build complete."

# --- Build x86_64 ---
echo ""
echo "[4/6] Building x86_64-apple-darwin (Intel)..."
pnpm tauri build --target x86_64-apple-darwin $TAURI_EXTRA_ARGS 2>&1 | tee /tmp/tauri-build-x86_64.log
echo "  x86_64 build complete."

# --- Collect Artifacts ---
echo ""
echo "[5/6] Collecting artifacts..."

AARCH64_BUNDLE="src-tauri/target/aarch64-apple-darwin/release/bundle"
X86_64_BUNDLE="src-tauri/target/x86_64-apple-darwin/release/bundle"
STAGING="/tmp/tokenicode-release-$TAG"
rm -rf "$STAGING"
mkdir -p "$STAGING"

# DMGs
cp "$AARCH64_BUNDLE/dmg/"*.dmg "$STAGING/" 2>/dev/null && echo "  aarch64 DMG copied" || echo "  WARN: no aarch64 DMG found"
cp "$X86_64_BUNDLE/dmg/"*.dmg "$STAGING/" 2>/dev/null && echo "  x86_64 DMG copied" || echo "  WARN: no x86_64 DMG found"

# Updater artifacts (.app.tar.gz and .sig)
# Rename with arch suffix — both arches produce "${PRODUCT_NAME}.app.tar.gz",
# same-name cp would silently overwrite and we'd lose one arch's updater.
AARCH64_TARBALL="$AARCH64_BUNDLE/macos/${PRODUCT_NAME}.app.tar.gz"
X86_64_TARBALL="$X86_64_BUNDLE/macos/${PRODUCT_NAME}.app.tar.gz"
cp "$AARCH64_TARBALL"     "$STAGING/${PRODUCT_NAME}_aarch64.app.tar.gz"     2>/dev/null && echo "  aarch64 updater tar.gz copied" || echo "  WARN: no aarch64 tar.gz"
cp "$AARCH64_TARBALL.sig" "$STAGING/${PRODUCT_NAME}_aarch64.app.tar.gz.sig" 2>/dev/null && echo "  aarch64 signature copied" || echo "  WARN: no aarch64 sig"
cp "$X86_64_TARBALL"      "$STAGING/${PRODUCT_NAME}_x64.app.tar.gz"         2>/dev/null && echo "  x86_64 updater tar.gz copied" || echo "  WARN: no x86_64 tar.gz"
cp "$X86_64_TARBALL.sig"  "$STAGING/${PRODUCT_NAME}_x64.app.tar.gz.sig"     2>/dev/null && echo "  x86_64 signature copied" || echo "  WARN: no x86_64 sig"

echo ""
echo "  Artifacts in $STAGING:"
ls -lh "$STAGING/"

# --- Upload to GitHub Release ---
echo ""
echo "[6/6] Uploading to GitHub Draft Release ($TAG)..."

for file in "$STAGING"/*; do
    fname=$(basename "$file")
    echo "  Uploading: $fname"
    gh release upload "$TAG" "$file" --clobber
done

echo ""
echo "============================================"
echo " Build complete!"
echo " Draft Release: https://github.com/yiliqi78/TOKENICODE/releases/tag/$TAG"
echo ""
echo " Next steps:"
echo "   1. Verify artifacts on the release page"
echo "   2. Update release body"
echo "   3. Publish the release (remove draft)"
echo "============================================"
