#!/usr/bin/env bash
# run-e2e.sh — run TOKENICODE E2E suites and store stable reports.
#
# Usage:
#   bash .test/scripts/run-e2e.sh [--phase all|1|2|3] [runner flags]
#
# Common runner flags are forwarded to scripts/run-tests.mjs:
#   --detail minimal|standard|full
#   --retry N
#   --test-timeout MS
#   --stop-after N
#   --no-snapshots
#   --no-auto-restart

set -euo pipefail
cd "$(dirname "$0")/../.."

CLI=(node scripts/tokenicode-cli.mjs)
RUNNER=(node scripts/run-tests.mjs)
TIMESTAMP=$(date +%Y-%m-%d_%H-%M-%S)
REPORT_DIR=".test/runs/$TIMESTAMP-e2e"
PHASE="all"
DETAIL="standard"
RUNNER_ARGS=()

usage() {
  sed -n '1,18p' "$0"
}

while [ $# -gt 0 ]; do
  case "$1" in
    --phase)
      PHASE="${2:-}"
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

if [[ ! "$PHASE" =~ ^(all|1|2|3)$ ]]; then
  echo "Invalid phase: $PHASE (expected all, 1, 2, or 3)" >&2
  exit 2
fi

if [[ ! "$DETAIL" =~ ^(minimal|standard|full)$ ]]; then
  echo "Invalid detail level: $DETAIL (expected minimal, standard, or full)" >&2
  exit 2
fi

mkdir -p "$REPORT_DIR"

TOTAL_SUITES=0
TOTAL_PASSED=0
TOTAL_FAILED=0
TOTAL_SKIPPED=0
TOTAL_TESTS=0
FAILURES=()

suite_id() {
  local suite_file="$1"
  local rel="${suite_file#.test/suites/}"
  rel="${rel%.json}"
  printf '%s' "${rel//\//__}"
}

suite_label() {
  local suite_file="$1"
  local rel="${suite_file#.test/suites/}"
  printf '%s' "${rel%.json}"
}

parse_summary() {
  local log_file="$1"
  python3 - "$log_file" <<'PY'
import json
import sys

summary = None
for line in open(sys.argv[1], encoding="utf-8", errors="replace"):
    line = line.strip()
    if not line.startswith("{"):
        continue
    try:
        obj = json.loads(line)
    except json.JSONDecodeError:
        continue
    if obj.get("_summary"):
        summary = obj

if not summary:
    print("0 0 0 0 no-summary")
else:
    print(
        int(summary.get("total", 0) or 0),
        int(summary.get("passed", 0) or 0),
        int(summary.get("failed", 0) or 0),
        int(summary.get("skipped", 0) or 0),
        "ok",
    )
PY
}

run_suite() {
  local suite_file="$1"
  local id label log_file report_file runner_status total passed failed skipped parse_status
  id="$(suite_id "$suite_file")"
  label="$(suite_label "$suite_file")"
  log_file="$REPORT_DIR/$id.ndjson"
  report_file="$REPORT_DIR/$id.report.json"

  echo "─── $label ───"
  TOTAL_SUITES=$((TOTAL_SUITES + 1))

  if "${RUNNER[@]}" "$suite_file" --report "$report_file" --detail "$DETAIL" "${RUNNER_ARGS[@]}" > "$log_file" 2>&1; then
    runner_status=0
  else
    runner_status=$?
  fi

  read -r total passed failed skipped parse_status < <(parse_summary "$log_file")

  if [ "$parse_status" != "ok" ]; then
    failed=1
    total=1
    FAILURES+=("$label: runner produced no summary (exit $runner_status), see $log_file")
  elif [ "$runner_status" -ne 0 ] && [ "$failed" -eq 0 ]; then
    failed=1
    total=$((total > 0 ? total : 1))
    FAILURES+=("$label: runner exited $runner_status without failed tests, see $log_file")
  elif [ "$failed" -gt 0 ] || [ "$skipped" -gt 0 ]; then
    FAILURES+=("$label: $failed failed, $skipped skipped / $total tests")
  fi

  TOTAL_PASSED=$((TOTAL_PASSED + passed))
  TOTAL_FAILED=$((TOTAL_FAILED + failed))
  TOTAL_SKIPPED=$((TOTAL_SKIPPED + skipped))
  TOTAL_TESTS=$((TOTAL_TESTS + total))

  if [ "$failed" -gt 0 ] || [ "$skipped" -gt 0 ]; then
    echo "  failed: $failed, skipped: $skipped, passed: $passed/$total"
    echo "  log:    $log_file"
    echo "  report: $report_file"
  else
    echo "  passed: $passed/$total"
  fi
}

echo "=== TOKENICODE E2E Test Run — $TIMESTAMP ==="
echo "Report directory: $REPORT_DIR"
echo ""
echo "Checking test harness connectivity..."
if ! "${CLI[@]}" ping > /dev/null 2>&1; then
  echo "Cannot connect to TOKENICODE test socket. Start the debug app with: pnpm tauri dev"
  exit 1
fi
echo "Connected"

mkdir -p /tmp/tokenicode-test
if [ ! -f /tmp/tokenicode-test/README.md ]; then
  {
    echo "# TOKENICODE test fixture"
    echo "Auto-created by .test/scripts/run-e2e.sh. Keep this directory non-empty during test runs."
  } > /tmp/tokenicode-test/README.md
fi
echo "Test fixture: /tmp/tokenicode-test"
echo ""

if [ "$PHASE" = "all" ] || [ "$PHASE" = "1" ]; then
  echo "=== Phase 1: basic checks without LLM ==="
  run_suite ".test/suites/health-and-status/full-health.json"
  run_suite ".test/suites/session-management/session-ops.json"
  run_suite ".test/suites/ui-state-checks/ui-elements.json"
  run_suite ".test/suites/settings-panel/settings-operations.json"
  echo ""
fi

if [ "$PHASE" = "all" ] || [ "$PHASE" = "2" ]; then
  echo "=== Phase 2: LLM interaction checks ==="
  run_suite ".test/suites/basic-chat/send-receive.json"
  run_suite ".test/suites/interrupt-recovery/interrupt-then-send.json"
  run_suite ".test/suites/message-during-stream/msg-while-streaming.json"
  run_suite ".test/suites/streaming-stress/stream-stall.json"
  run_suite ".test/suites/model-switching/model-and-provider.json"
  run_suite ".test/suites/multi-session/tab-switching.json"
  run_suite ".test/suites/no-response-filter/early-interrupt.json"
  run_suite ".test/suites/slash-commands/command-recognition.json"
  run_suite ".test/suites/provider-persistence/provider-revert.json"
  echo ""
fi

if [ "$PHASE" = "all" ] || [ "$PHASE" = "3" ]; then
  echo "=== Phase 3: branch regression checks ==="
  run_suite ".test/suites/stdinid-race-fix/basic-regression.json"
  run_suite ".test/suites/stdinid-race-fix/full-validation.json"
  run_suite ".test/suites/stdinid-race-fix/interrupt-recovery.json"
  run_suite ".test/suites/stdinid-race-fix/empty-message.json"
  echo ""
fi

cat > "$REPORT_DIR/SUMMARY.md" << SUMMARY
# E2E Test Run — $TIMESTAMP

| Metric | Value |
|--------|-------|
| Suites | $TOTAL_SUITES |
| Tests | $TOTAL_TESTS |
| Passed | $TOTAL_PASSED |
| Failed | $TOTAL_FAILED |
| Skipped | $TOTAL_SKIPPED |
| Detail | $DETAIL |

## Failed Suites
$(if [ ${#FAILURES[@]} -gt 0 ]; then for f in "${FAILURES[@]}"; do echo "- $f"; done; else echo "None"; fi)

## Artifacts

- Runner logs: \`*.ndjson\`
- Structured reports: \`*.report.json\`
SUMMARY

echo "========================================"
echo "  Total suites:  $TOTAL_SUITES"
echo "  Total tests:   $TOTAL_TESTS"
echo "  Passed:        $TOTAL_PASSED"
echo "  Failed:        $TOTAL_FAILED"
echo "  Skipped:       $TOTAL_SKIPPED"
echo "  Reports:       $REPORT_DIR/"
echo "========================================"
echo "Summary written to $REPORT_DIR/SUMMARY.md"

if [ "$TOTAL_FAILED" -gt 0 ] || [ "$TOTAL_SKIPPED" -gt 0 ]; then
  exit 1
fi
