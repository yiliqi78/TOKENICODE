#!/usr/bin/env bash
# Run every currently defined TOKENICODE E2E phase, then analyze the reports.

set -euo pipefail
cd "$(dirname "$0")/../.."

status=0
bash .test/scripts/run-e2e.sh --phase all "$@" || status=$?

latest_run="$(python3 - <<'PY'
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
)"

if [ -n "${latest_run:-}" ]; then
  echo ""
  python3 .test/scripts/analyze-reports.py "$latest_run" || true
fi

exit "$status"
