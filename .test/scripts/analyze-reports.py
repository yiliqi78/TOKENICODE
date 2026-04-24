#!/usr/bin/env python3
"""
Summarize TOKENICODE E2E reports.

Supported inputs:
  - New run directories from .test/scripts/run-e2e.sh:
      *.report.json structured reports plus *.ndjson runner logs.
  - Legacy run directories:
      <suite>/run-001.json structured reports.
  - Old flat runner logs:
      <suite>.json files containing mixed stderr + JSON summary lines.
"""

import glob
import json
import os
import sys
from collections import defaultdict


def latest_runs_dir() -> str | None:
    script_dir = os.path.dirname(os.path.abspath(__file__))
    runs_dir = os.path.abspath(os.path.join(script_dir, "..", "runs"))
    if not os.path.isdir(runs_dir):
        return None
    subdirs = [
        os.path.join(runs_dir, d)
        for d in os.listdir(runs_dir)
        if os.path.isdir(os.path.join(runs_dir, d))
    ]
    if not subdirs:
        return None
    return max(subdirs, key=os.path.getmtime)


def suite_from_test_file(test_file: str | None) -> str | None:
    if not test_file:
        return None
    normalized = test_file.replace("\\", "/")
    marker = ".test/suites/"
    if marker in normalized:
        normalized = normalized.split(marker, 1)[1]
    if normalized.endswith(".json"):
        normalized = normalized[:-5]
    return normalized or None


def suite_from_path(path: str, base: str) -> str:
    name = os.path.basename(path)
    if name.endswith(".report.json"):
        return name[:-12].replace("__", "/")
    if name.endswith(".ndjson"):
        return name[:-7].replace("__", "/")
    if name.endswith(".json"):
        parent = os.path.basename(os.path.dirname(path))
        if name.startswith("run-") and parent != os.path.basename(base):
            return parent
        return name[:-5].replace("__", "/")
    return os.path.splitext(name)[0].replace("__", "/")


def load_structured_report(path: str):
    try:
        with open(path, "r", encoding="utf-8", errors="replace") as fh:
            report = json.load(fh)
    except (OSError, json.JSONDecodeError):
        return None
    if not isinstance(report, dict) or "meta" not in report:
        return None
    return report


def load_ndjson_summary(path: str):
    summary = None
    try:
        fh = open(path, "r", encoding="utf-8", errors="replace")
    except OSError:
        return None

    with fh:
        for line in fh:
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
        return None

    return {
        "meta": {
            "totalTests": int(summary.get("total", 0) or 0),
            "passed": int(summary.get("passed", 0) or 0),
            "failed": int(summary.get("failed", 0) or 0),
            "skipped": int(summary.get("skipped", 0) or 0),
            "elapsed": int(summary.get("elapsed", 0) or 0),
            "aborted": bool(summary.get("aborted", False)),
            "config": {"testFile": None},
        },
        "issues": [],
        "_summaryOnly": True,
    }


def collect_reports(base: str):
    base = os.path.abspath(base)
    candidates = []
    patterns = [
        os.path.join(base, "*.report.json"),
        os.path.join(base, "*.ndjson"),
        os.path.join(base, "*.json"),
        os.path.join(base, "*", "run-*.json"),
    ]
    for pattern in patterns:
        candidates.extend(glob.glob(pattern))

    seen_paths = set()
    seen_structured_keys = set()
    reports = []

    for path in sorted(candidates):
        if path in seen_paths:
            continue
        seen_paths.add(path)
        if path.endswith(".ndjson"):
            report_path = path[:-7] + ".report.json"
            if os.path.exists(report_path):
                continue

        report = load_structured_report(path)
        source_kind = "report"
        if report is None:
            report = load_ndjson_summary(path)
            source_kind = "summary"
        if report is None:
            continue

        meta = report.get("meta", {})
        path_suite = suite_from_path(path, base)
        is_legacy_run_file = (
            os.path.basename(path).startswith("run-")
            and os.path.basename(os.path.dirname(path)) != os.path.basename(base)
        )
        suite = path_suite if is_legacy_run_file else (
            suite_from_test_file(meta.get("config", {}).get("testFile")) or path_suite
        )
        key = (
            suite,
            meta.get("startTime"),
            meta.get("endTime"),
            meta.get("totalTests"),
            meta.get("passed"),
            meta.get("failed"),
            meta.get("skipped"),
        )
        if source_kind == "summary" and key in seen_structured_keys:
            continue
        if source_kind == "report":
            seen_structured_keys.add(key)

        reports.append((suite, path, report, source_kind))

    return reports


def categorize_error(error: str) -> str:
    lower = error.lower()
    if "timeout waiting for js execution" in error:
        return "JS execution timeout / app unresponsive"
    if "socket" in lower and ("closed" in lower or "refused" in lower or "not found" in lower):
        return "Socket / app connectivity"
    if "timeout" in lower or "killed after" in lower:
        return "Command timeout"
    if "assert" in lower:
        return "Assertion failed"
    return error[:120] or "(empty error)"


def analyze(base: str) -> int:
    reports = collect_reports(base)
    print(f"Analyzing: {base}")
    print()

    if not reports:
        print("No reports found.")
        return 1

    suite_stats = defaultdict(lambda: {
        "runs": 0,
        "total": 0,
        "passed": 0,
        "failed": 0,
        "skipped": 0,
        "elapsed": 0,
        "summary_only": 0,
        "failure_map": defaultdict(int),
        "error_patterns": defaultdict(int),
        "sources": [],
    })

    for suite, path, report, source_kind in reports:
        meta = report.get("meta", {})
        stats = suite_stats[suite]
        stats["runs"] += 1
        stats["total"] += int(meta.get("totalTests", 0) or 0)
        stats["passed"] += int(meta.get("passed", 0) or 0)
        stats["failed"] += int(meta.get("failed", 0) or 0)
        stats["skipped"] += int(meta.get("skipped", 0) or 0)
        stats["elapsed"] += int(meta.get("elapsed", 0) or 0)
        stats["summary_only"] += 1 if source_kind == "summary" else 0
        stats["sources"].append(os.path.relpath(path, os.getcwd()))

        for issue in report.get("issues", []):
            test_name = issue.get("test", "unknown")
            error = issue.get("error", "")
            issue_type = issue.get("type", "")
            if issue_type == "test_failure":
                stats["failure_map"][test_name] += 1
            stats["error_patterns"][categorize_error(error)] += 1

    print("=" * 72)
    print("  TOKENICODE E2E Summary")
    print("=" * 72)
    print()

    grand_total = grand_passed = grand_failed = grand_skipped = 0

    for suite in sorted(suite_stats):
        stats = suite_stats[suite]
        total = stats["total"]
        passed = stats["passed"]
        failed = stats["failed"]
        skipped = stats["skipped"]
        rate = (passed / total * 100) if total else 0

        grand_total += total
        grand_passed += passed
        grand_failed += failed
        grand_skipped += skipped

        print(f"┌─ {suite}")
        print(
            f"│  runs: {stats['runs']}  tests: {total}  "
            f"passed: {passed}  failed: {failed}  skipped: {skipped}"
        )
        print(f"│  pass rate: {rate:.1f}%  elapsed: {stats['elapsed']}ms")
        if stats["summary_only"]:
            print(f"│  summary-only files: {stats['summary_only']} (no issue details available)")

        if stats["failure_map"]:
            print("│  failing tests:")
            for test_name, count in sorted(stats["failure_map"].items(), key=lambda item: -item[1]):
                print(f"│    - {test_name}: {count} run(s)")

        if stats["error_patterns"]:
            print("│  error patterns:")
            for pattern, count in sorted(stats["error_patterns"].items(), key=lambda item: -item[1]):
                print(f"│    - {pattern}: {count}")

        print("└─")
        print()

    grand_rate = (grand_passed / grand_total * 100) if grand_total else 0
    print("=" * 72)
    print(
        f"  total: {grand_total} tests, {grand_passed} passed, "
        f"{grand_failed} failed, {grand_skipped} skipped"
    )
    print(f"  pass rate: {grand_rate:.1f}%")
    print("=" * 72)

    print()
    print("--- Intermittent failures ---")
    found = False
    for suite in sorted(suite_stats):
        stats = suite_stats[suite]
        runs = stats["runs"]
        for test_name, fail_count in stats["failure_map"].items():
            if 0 < fail_count < runs:
                found = True
                print(f"  {suite} / {test_name}: {fail_count}/{runs} failed")
    if not found:
        print("  None")

    print()
    print("--- Stable failures ---")
    found = False
    for suite in sorted(suite_stats):
        stats = suite_stats[suite]
        runs = stats["runs"]
        for test_name, fail_count in stats["failure_map"].items():
            if runs > 1 and fail_count >= runs:
                found = True
                print(f"  {suite} / {test_name}: failed in all {runs} runs")
    if not found:
        print("  None")

    return 0


def main() -> int:
    base = sys.argv[1] if len(sys.argv) > 1 else latest_runs_dir()
    if not base:
        print("No run directories found in .test/runs")
        return 1
    return analyze(base)


if __name__ == "__main__":
    raise SystemExit(main())
