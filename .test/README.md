# TOKENICODE Test Harness

`.test/` holds the GUI E2E suites and the scripts used to run and analyze them.

The harness drives a debug TOKENICODE app through `scripts/tokenicode-cli.mjs`.
It is not available in production builds.

## Quick Start

1. Start the app in debug mode:

   ```bash
   pnpm tauri dev
   ```

2. Confirm the socket is reachable:

   ```bash
   node scripts/tokenicode-cli.mjs ping
   ```

3. Run the non-LLM smoke phase first:

   ```bash
   bash .test/scripts/run-e2e.sh --phase 1 --detail minimal
   ```

4. Run all phases when the smoke phase is stable:

   ```bash
   bash .test/scripts/run-all-phases.sh --detail minimal
   ```

5. Run repeated branch validation after all harness smoke checks are stable:

   ```bash
   bash .test/scripts/run-branch-validation.sh --cycles 3 --phases 1,2,3 --detail minimal --retry 1
   ```

Every run writes a timestamped directory under `.test/runs/`.
The latest source-controlled branch validation summary is in
`.test/BRANCH-VALIDATION.md`.

## Artifacts

New E2E runs write two files per suite:

| File | Purpose |
|------|---------|
| `*.ndjson` | Runner stdout/stderr log with one JSON summary line per test and final `_summary`. |
| `*.report.json` | Full structured report with `meta`, `issues`, and per-step records. |
| `SUMMARY.md` | Human-readable run summary. |

Analyze a run directory with:

```bash
python3 .test/scripts/analyze-reports.py .test/runs/<timestamp>-e2e
```

Without an argument, the analyzer scans the latest run directory.

## Suites

Suites live in `.test/suites/<area>/<name>.json`.

Use `.test/suites/examples/health-smoke.json` as the smallest copyable template.
Prefer `new-session --cwd /tmp/tokenicode-test` for tests that need the editor.
`new-session` without `--cwd` intentionally lands on the welcome page and has no editor.

## Creating A New Suite

1. Create a focused file under `.test/suites/<area>/<case>.json`.
2. Keep setup explicit: create or switch to the session you need.
3. Add assertions to the command outputs that matter.
4. Add teardown with `stop` and `delete-session` when the test creates sessions.
5. Run the single suite before adding it to `run-e2e.sh`:

   ```bash
   node scripts/run-tests.mjs .test/suites/<area>/<case>.json \
     --report .test/runs/manual-<case>.report.json \
     --detail standard
   ```

## Branch Validation Notes

After the harness itself is healthy, use it for branch validation.
For mass runs, one pass is not enough for timing-sensitive bugs.

The branch validation wrapper writes `RUNS.md` and `BUGS.md` under
`.test/runs/<timestamp>-branch-validation/`. It records only the failing
suite/test/command, a compact error, and the report artifact path.

Record only the minimum useful evidence in a markdown file in the run directory:

```markdown
# Branch Validation Bugs

| ID | Suite / round | Test | Symptom | Evidence |
|----|---------------|------|---------|----------|
| B01 | phase2 round 03 | interrupt-recovery / T02 | second send stays active after stop | `interrupt-recovery__interrupt-then-send.report.json`, issue 0 |
```

During branch validation, record bugs first. Do not fix product bugs in the same pass unless the task explicitly switches back to fixing.
