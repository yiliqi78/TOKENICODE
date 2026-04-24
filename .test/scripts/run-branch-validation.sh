#!/usr/bin/env bash
# Run repeated TOKENICODE E2E phases and record minimal failure rows.

set -euo pipefail
cd "$(dirname "$0")/../.."

CYCLES=2
PHASES="1,2,3"
DETAIL="minimal"
RETRY=0
RUNNER_ARGS=()
STAMP=$(date +%Y-%m-%d_%H-%M-%S)
VALIDATION_DIR=".test/runs/$STAMP-branch-validation"
BUGS_MD="$VALIDATION_DIR/BUGS.md"
RUNS_MD="$VALIDATION_DIR/RUNS.md"

usage() {
  sed -n '1,18p' "$0"
  cat <<'USAGE'

Options:
  --cycles N             Number of full phase cycles to run (default: 2)
  --phases LIST          Comma-separated phases, for example 1,3 or 1,2,3
  --detail LEVEL         minimal|standard|full (default: minimal)
  --retry N              Forwarded to run-e2e.sh
  --test-timeout MS      Forwarded to run-e2e.sh
  --stop-after N         Forwarded to run-e2e.sh
  --no-snapshots         Forwarded to run-e2e.sh
  --no-auto-restart      Forwarded to run-e2e.sh
USAGE
}

while [ $# -gt 0 ]; do
  case "$1" in
    --cycles)
      CYCLES="${2:-}"
      shift 2
      ;;
    --phases)
      PHASES="${2:-}"
      shift 2
      ;;
    --detail)
      DETAIL="${2:-}"
      shift 2
      ;;
    --retry|--test-timeout|--stop-after)
      RUNNER_ARGS+=("$1" "${2:-}")
      shift 2
      ;;
    --no-snapshots|--no-auto-restart)
      RUNNER_ARGS+=("$1")
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown argument: $1" >&2
      usage >&2
      exit 2
      ;;
  esac
done

if ! [[ "$CYCLES" =~ ^[0-9]+$ ]] || [ "$CYCLES" -lt 1 ]; then
  echo "Invalid --cycles: $CYCLES" >&2
  exit 2
fi

if [[ ! "$DETAIL" =~ ^(minimal|standard|full)$ ]]; then
  echo "Invalid --detail: $DETAIL" >&2
  exit 2
fi

IFS=',' read -r -a PHASE_LIST <<< "$PHASES"
for phase in "${PHASE_LIST[@]}"; do
  if [[ ! "$phase" =~ ^(1|2|3)$ ]]; then
    echo "Invalid phase in --phases: $phase" >&2
    exit 2
  fi
done

mkdir -p "$VALIDATION_DIR"

cat > "$BUGS_MD" <<BUGS
# Branch Validation Bugs — $STAMP

| Time | Cycle | Phase | Suite | Test | Command | Minimal Failure | Artifact |
|------|-------|-------|-------|------|---------|-----------------|----------|
BUGS

cat > "$RUNS_MD" <<RUNS
# Branch Validation Runs — $STAMP

| Time | Cycle | Phase | Exit | Run Directory |
|------|-------|-------|------|---------------|
RUNS

latest_e2e_run() {
  python3 - <<'PY'
import os

runs_dir = ".test/runs"
dirs = []
if os.path.isdir(runs_dir):
    dirs = [
        os.path.join(runs_dir, name)
        for name in os.listdir(runs_dir)
        if name.endswith("-e2e") and os.path.isdir(os.path.join(runs_dir, name))
    ]
if dirs:
    print(max(dirs, key=os.path.getmtime))
PY
}

record_failures() {
  local run_dir="$1"
  local cycle="$2"
  local phase="$3"
  python3 - "$run_dir" "$cycle" "$phase" "$BUGS_MD" <<'PY'
import glob
import json
import os
import sys
from datetime import datetime

run_dir, cycle, phase, bugs_md = sys.argv[1:5]
timestamp = datetime.now().strftime("%Y-%m-%d %H:%M:%S")

def suite_name(report, path):
    test_file = report.get("meta", {}).get("config", {}).get("testFile")
    if test_file and ".test/suites/" in test_file:
        name = test_file.split(".test/suites/", 1)[1]
        return name[:-5] if name.endswith(".json") else name
    base = os.path.basename(path)
    return base[:-12].replace("__", "/") if base.endswith(".report.json") else base

def compact(value, limit=160):
    text = " ".join(str(value or "").replace("\n", " ").split())
    return text[: limit - 1] + "…" if len(text) > limit else text

rows = []
for path in sorted(glob.glob(os.path.join(run_dir, "*.report.json"))):
    try:
        with open(path, encoding="utf-8", errors="replace") as fh:
            report = json.load(fh)
    except (OSError, json.JSONDecodeError):
        continue
    suite = suite_name(report, path)
    artifact = os.path.relpath(path, os.getcwd())
    for issue in report.get("issues", []):
        step = issue.get("failedStep") or {}
        rows.append([
            timestamp,
            cycle,
            phase,
            suite,
            issue.get("test", "unknown"),
            step.get("cmd", ""),
            compact(issue.get("error") or step.get("error")),
            artifact,
        ])

if rows:
    with open(bugs_md, "a", encoding="utf-8") as fh:
        for row in rows:
            escaped = [str(cell).replace("|", "\\|") for cell in row]
            fh.write("| " + " | ".join(escaped) + " |\n")
PY
}

failures=0

echo "Branch validation directory: $VALIDATION_DIR"
echo "Bugs: $BUGS_MD"
echo "Runs: $RUNS_MD"

for cycle in $(seq 1 "$CYCLES"); do
  for phase in "${PHASE_LIST[@]}"; do
    echo ""
    echo "=== Branch validation cycle $cycle/$CYCLES phase $phase ==="
    run_status=0
    bash .test/scripts/run-e2e.sh --phase "$phase" --detail "$DETAIL" "${RUNNER_ARGS[@]}" || run_status=$?
    run_dir="$(latest_e2e_run)"
    now="$(date '+%Y-%m-%d %H:%M:%S')"
    printf '| %s | %s | %s | %s | %s |\n' "$now" "$cycle" "$phase" "$run_status" "$run_dir" >> "$RUNS_MD"
    if [ -n "$run_dir" ]; then
      python3 .test/scripts/analyze-reports.py "$run_dir" > "$VALIDATION_DIR/cycle-$cycle-phase-$phase-analysis.txt" || true
      record_failures "$run_dir" "$cycle" "$phase"
    fi
    if [ "$run_status" -ne 0 ]; then
      failures=$((failures + 1))
    fi
  done
done

echo ""
echo "Branch validation complete."
echo "Runs: $RUNS_MD"
echo "Bugs: $BUGS_MD"

if [ "$failures" -gt 0 ]; then
  exit 1
fi
