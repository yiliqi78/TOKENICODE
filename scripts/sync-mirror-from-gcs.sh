#!/usr/bin/env bash
#
# sync-mirror-from-gcs.sh
#
# Mirror Anthropic's public Claude Code release bucket to the local filesystem.
# Intended to run on the herear.cn server as a cron job so TOKENICODE's China
# users get an up-to-date `claude` binary (2026-04 incident: mirror was 22
# versions behind GCS → Windows users couldn't install CLI at all).
#
# Default cron line (server-side):
#   */15 * * * * /opt/mirror/sync-mirror-from-gcs.sh >> /var/log/cc-mirror.log 2>&1
#
# The sync only downloads new versions (by comparing /latest). Nothing is
# re-downloaded if we're already at the latest. One successful run takes
# ~5 minutes on a 100 Mbps link (≈1.5 GB for all 8 platforms).
#
# Dependencies: curl, jq, sha256sum (or shasum on macOS). No gsutil needed —
# the bucket is publicly readable via HTTPS.

set -euo pipefail

GCS_BASE="${GCS_BASE:-https://storage.googleapis.com/claude-code-dist-86c565f3-f756-42ad-8dfa-d59b1c096819/claude-code-releases}"
MIRROR_ROOT="${MIRROR_ROOT:-/var/www/herear.cn/releases/claude-code}"
PLATFORMS=(darwin-arm64 darwin-x64 linux-arm64 linux-x64 linux-arm64-musl linux-x64-musl win32-x64 win32-arm64)

log() { printf '[%s] %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*"; }

# --- sha256 helper (portable) ---
sha256_of() {
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$1" | awk '{print $1}'
  else
    shasum -a 256 "$1" | awk '{print $1}'
  fi
}

mkdir -p "$MIRROR_ROOT"

# --- Step 1: Fetch GCS /latest ---
GCS_LATEST="$(curl -fsSL "$GCS_BASE/latest" | tr -d '[:space:]')"
if [[ -z "$GCS_LATEST" ]]; then
  log "ERROR: could not fetch GCS /latest"
  exit 1
fi
log "GCS latest: $GCS_LATEST"

# --- Step 2: Compare with local /latest ---
LOCAL_LATEST_FILE="$MIRROR_ROOT/latest"
LOCAL_LATEST=""
[[ -f "$LOCAL_LATEST_FILE" ]] && LOCAL_LATEST="$(tr -d '[:space:]' < "$LOCAL_LATEST_FILE")"

if [[ "$LOCAL_LATEST" == "$GCS_LATEST" ]] && [[ -d "$MIRROR_ROOT/$GCS_LATEST" ]]; then
  log "Mirror already at $GCS_LATEST — nothing to do"
  exit 0
fi

log "Mirror at '${LOCAL_LATEST:-<none>}', syncing version $GCS_LATEST"

# --- Step 3: Fetch manifest for the new version ---
VERSION_DIR="$MIRROR_ROOT/$GCS_LATEST"
mkdir -p "$VERSION_DIR"

MANIFEST_TMP="$VERSION_DIR/manifest.json.tmp"
curl -fsSL "$GCS_BASE/$GCS_LATEST/manifest.json" -o "$MANIFEST_TMP"
if ! jq -e . "$MANIFEST_TMP" >/dev/null; then
  log "ERROR: manifest is not valid JSON"
  rm -f "$MANIFEST_TMP"
  exit 1
fi
mv "$MANIFEST_TMP" "$VERSION_DIR/manifest.json"
log "Fetched manifest for $GCS_LATEST"

# --- Step 4: Download each platform binary + verify checksum ---
FAILED=()
for platform in "${PLATFORMS[@]}"; do
  # Some versions may not ship every platform — skip if absent from manifest.
  if ! jq -e ".platforms[\"$platform\"]" "$VERSION_DIR/manifest.json" >/dev/null 2>&1; then
    log "  skip: platform $platform not in manifest"
    continue
  fi

  binary_name=$(jq -r ".platforms[\"$platform\"].binary" "$VERSION_DIR/manifest.json")
  expected=$(jq -r ".platforms[\"$platform\"].checksum" "$VERSION_DIR/manifest.json")

  platform_dir="$VERSION_DIR/$platform"
  mkdir -p "$platform_dir"
  dest="$platform_dir/$binary_name"
  tmp="$dest.tmp"

  # Skip if already have this file with matching checksum (resumable).
  if [[ -f "$dest" ]] && [[ "$(sha256_of "$dest")" == "$expected" ]]; then
    log "  ok: $platform/$binary_name (cached, checksum OK)"
    continue
  fi

  url="$GCS_BASE/$GCS_LATEST/$platform/$binary_name"
  log "  download: $url"
  if ! curl -fsSL --retry 3 --retry-delay 5 "$url" -o "$tmp"; then
    log "  FAIL: download $platform"
    rm -f "$tmp"
    FAILED+=("$platform")
    continue
  fi

  actual=$(sha256_of "$tmp")
  if [[ "$actual" != "$expected" ]]; then
    log "  FAIL: $platform checksum mismatch (expected $expected, got $actual)"
    rm -f "$tmp"
    FAILED+=("$platform")
    continue
  fi

  mv "$tmp" "$dest"
  log "  ok: $platform/$binary_name ($(du -h "$dest" | awk '{print $1}'))"
done

if [[ ${#FAILED[@]} -gt 0 ]]; then
  log "ERROR: ${#FAILED[@]} platform(s) failed: ${FAILED[*]}"
  # Don't update /latest if anything failed — clients should keep using old ver.
  exit 1
fi

# --- Step 5: Atomically update /latest pointer ---
echo -n "$GCS_LATEST" > "$MIRROR_ROOT/latest.tmp"
mv "$MIRROR_ROOT/latest.tmp" "$MIRROR_ROOT/latest"
log "Updated /latest → $GCS_LATEST"

# --- Step 6: Optional prune (keep only the N most recent versions) ---
KEEP="${KEEP_VERSIONS:-5}"
if [[ "$KEEP" -gt 0 ]]; then
  # shellcheck disable=SC2012
  to_prune=$(ls -1 "$MIRROR_ROOT" \
    | grep -E '^[0-9]+\.[0-9]+\.[0-9]+$' \
    | sort -V -r \
    | tail -n +"$((KEEP + 1))" || true)
  if [[ -n "$to_prune" ]]; then
    while IFS= read -r v; do
      log "  prune: $v"
      rm -rf "${MIRROR_ROOT:?}/$v"
    done <<< "$to_prune"
  fi
fi

log "Sync complete"
