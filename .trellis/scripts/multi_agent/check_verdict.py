#!/usr/bin/env python3
"""
Check the latest codex-review verdict for a task.

Usage:
    python3 .trellis/scripts/multi_agent/check_verdict.py [task_dir]

Reads the latest codex-review-*.txt file, extracts the Verdict line,
and outputs a machine-readable result.

Exit codes:
    0 = PASS (or PASS WITH NOTES)
    1 = FAIL
    2 = NO_REVIEW (no review file found)
    3 = PARSE_ERROR (verdict line not found)

Output (stdout):
    JSON: {"verdict": "PASS"|"PASS_WITH_NOTES"|"FAIL"|"NO_REVIEW"|"PARSE_ERROR",
           "file": "<path>", "models": "<model line>"}
"""

import glob
import json
import os
import re
import sys


def main():
    if len(sys.argv) < 2:
        task_dir = None
        repo_root = os.getcwd()
        current_task_file = os.path.join(repo_root, ".trellis", ".current-task")
        if os.path.isfile(current_task_file):
            with open(current_task_file) as f:
                task_dir = f.read().strip()
        if not task_dir:
            print(json.dumps({"verdict": "NO_REVIEW", "file": "", "models": ""}))
            sys.exit(2)
        task_dir = os.path.join(repo_root, task_dir)
    else:
        task_dir = sys.argv[1]
        if not os.path.isabs(task_dir):
            task_dir = os.path.join(os.getcwd(), task_dir)

    after_ts = float(sys.argv[2]) if len(sys.argv) >= 3 else 0

    review_files = sorted(glob.glob(os.path.join(task_dir, "codex-review-[0-9]*.txt")))
    if after_ts > 0:
        review_files = [f for f in review_files if os.path.getmtime(f) > after_ts]
    if not review_files:
        print(json.dumps({"verdict": "NO_REVIEW", "file": "", "models": ""}))
        sys.exit(2)

    latest = review_files[-1]

    verdict = None
    models = ""
    blockers = 0
    regressions = 0
    suggestions = 0
    with open(latest, "r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if line.startswith("## Models:"):
                models = line[len("## Models:"):].strip()
            m = re.match(r"^#{2,3}\s*Verdict:\s*(.+)$", line, re.IGNORECASE)
            if m and verdict is None:
                raw = m.group(1).strip().upper()
                if "PASS WITH NOTES" in raw:
                    verdict = "PASS_WITH_NOTES"
                elif "FAIL" in raw:
                    verdict = "FAIL"
                elif "PASS" in raw:
                    verdict = "PASS"
            if line.startswith("### [BLOCKER]"):
                blockers += 1
            elif line.startswith("### [REGRESSION]"):
                regressions += 1
            elif line.startswith("### [SUGGESTION]"):
                suggestions += 1
            elif re.match(r"^### \[(Critical|Major)\]", line):
                blockers += 1
            elif re.match(r"^### \[Minor\]", line):
                suggestions += 1

    if verdict is None:
        print(json.dumps({"verdict": "PARSE_ERROR", "file": latest, "models": models}))
        sys.exit(3)

    result = {
        "verdict": verdict,
        "file": os.path.basename(latest),
        "models": models,
        "blockers": blockers,
        "regressions": regressions,
        "suggestions": suggestions,
    }
    print(json.dumps(result))

    if verdict == "FAIL":
        sys.exit(1)
    else:
        sys.exit(0)


if __name__ == "__main__":
    main()
