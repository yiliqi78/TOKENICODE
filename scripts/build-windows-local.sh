#!/usr/bin/env bash
set -euo pipefail

# ============================================================
# TOKENICODE / TCAlpha Windows Cross-Build Script (macOS → Windows)
#
# Uses cargo-xwin to cross-compile Tauri for x86_64-pc-windows-msvc
# from a macOS host. Produces NSIS installer + portable + updater sig.
#
# Prerequisites:
#   brew install llvm
#   cargo install cargo-xwin
#   rustup target add x86_64-pc-windows-msvc
#
# Usage:
#   ./scripts/build-windows-local.sh              # stable (TOKENICODE)
#   EDITION=alpha ./scripts/build-windows-local.sh # alpha  (TCAlpha)
# ============================================================

PROJECT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$PROJECT_DIR"

EDITION="${EDITION:-stable}"
VERSION=$(python3 -c "import json; print(json.load(open('package.json'))['version'])")
TARGET="x86_64-pc-windows-msvc"

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
echo " $PRODUCT_NAME Windows Cross-Build"
echo " Edition: $EDITION  Version: $VERSION  Tag: $TAG"
echo " Target: $TARGET"
echo "============================================"

# --- Load .env if present ---
[ -f "$PROJECT_DIR/.env" ] && set -a && source "$PROJECT_DIR/.env" && set +a

# --- Signing (updater) ---
if [ -f "$HOME/.tauri/tokenicode.key" ]; then
  export TAURI_SIGNING_PRIVATE_KEY
  TAURI_SIGNING_PRIVATE_KEY="$(cat "$HOME/.tauri/tokenicode.key")"
  : "${TAURI_SIGNING_PRIVATE_KEY_PASSWORD:?Set TAURI_SIGNING_PRIVATE_KEY_PASSWORD in .env or environment}"
  export TAURI_SIGNING_PRIVATE_KEY_PASSWORD
fi
export EDITION

# --- Preflight Checks ---
echo ""
echo "[1/5] Preflight checks..."
command -v pnpm   >/dev/null || { echo "ERROR: pnpm not found"; exit 1; }
command -v cargo  >/dev/null || { echo "ERROR: cargo not found"; exit 1; }
rustup target list --installed | grep -q "$TARGET" || {
  echo "ERROR: Rust target $TARGET not installed. Run: rustup target add $TARGET"; exit 1;
}
command -v cargo-xwin >/dev/null || {
  echo "ERROR: cargo-xwin not found. Run: cargo install cargo-xwin"; exit 1;
}

# Verify LLVM tools (clang-cl needed for C dependency compilation)
LLVM_BIN="/opt/homebrew/opt/llvm/bin"
if [ ! -x "$LLVM_BIN/clang-cl" ]; then
  echo "ERROR: clang-cl not found at $LLVM_BIN/clang-cl"
  echo "       Run: brew install llvm"
  exit 1
fi
echo "  All checks passed."

# --- Inject cargo-xwin cross-compilation environment ---
echo ""
echo "[2/5] Setting up cross-compilation environment..."
eval "$(cargo xwin env --target "$TARGET" 2>/dev/null)"

# Override linker with full path to xwin's bundled lld-link binary.
# Cargo 1.85+ maps bare "lld-link" to its internal rust-lld, which
# mishandles the -flavor flag. Using the full path bypasses that.
XWIN_LLD_LINK="$HOME/Library/Caches/cargo-xwin/lld-link"
if [ -x "$XWIN_LLD_LINK" ]; then
  export CARGO_TARGET_X86_64_PC_WINDOWS_MSVC_LINKER="$XWIN_LLD_LINK"
fi

# Restore UTF-8 locale for NSIS. cargo-xwin sets LC_ALL=C which causes
# makensis to crash with std::bad_alloc when compiling Unicode installers.
export LC_ALL=en_US.UTF-8
export LANG=en_US.UTF-8

echo "  CC=$CC_x86_64_pc_windows_msvc"
echo "  Linker=$CARGO_TARGET_X86_64_PC_WINDOWS_MSVC_LINKER"
echo "  SDK cache: $(dirname "$(echo "$LIB" | cut -d';' -f1)")"

# --- Install Dependencies ---
echo ""
echo "[3/5] Installing dependencies..."
pnpm install --frozen-lockfile

# --- Build ---
echo ""
echo "[4/5] Building for $TARGET..."
pnpm tauri build --target "$TARGET" $TAURI_EXTRA_ARGS 2>&1 | tee /tmp/tauri-build-windows.log
echo "  Windows build complete."

# --- Collect Artifacts ---
echo ""
echo "[5/5] Collecting artifacts..."

WIN_BUNDLE="src-tauri/target/$TARGET/release/bundle"
STAGING="/tmp/tokenicode-windows-release-$TAG"
rm -rf "$STAGING"
mkdir -p "$STAGING"

# NSIS installer
cp "$WIN_BUNDLE/nsis/"*"$VERSION"*.exe "$STAGING/" 2>/dev/null && echo "  NSIS installer copied" || echo "  WARN: no NSIS installer found"

# Updater artifacts (nsis .sig)
cp "$WIN_BUNDLE/nsis/"*"$VERSION"*.sig "$STAGING/" 2>/dev/null && echo "  Updater signature copied" || echo "  WARN: no sig found"

echo ""
echo "  Artifacts in $STAGING:"
ls -lh "$STAGING/" 2>/dev/null || echo "  (empty)"

echo ""
echo "============================================"
echo " Windows cross-build complete!"
echo ""
echo " Next steps:"
echo "   1. Test the installer on a Windows machine"
echo "   2. Upload: gh release upload $TAG $STAGING/*"
echo "============================================"
