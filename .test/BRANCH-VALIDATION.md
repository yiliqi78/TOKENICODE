# Branch Validation Results

Date: 2026-04-24

## Harness Baseline

- `pnpm build`: passed
- `pnpm exec vitest run`: passed, 170 tests
- `cargo check`: passed with existing `objc/cocoa` warnings
- shell syntax checks for `.test/scripts/*.sh`: passed
- `python3 -m py_compile .test/scripts/analyze-reports.py`: passed
- `.test/suites/examples/health-smoke.json`: passed
- phase 1 smoke after harness fixes: passed 35/35
- `.test/suites/basic-chat/send-receive.json`: passed 4/4

## Runs

### Invalidated Harness Run

Path: `.test/runs/2026-04-24_03-52-57-branch-validation/`

Do not use this run as product evidence. It exposed a harness/app bridge bug where `status.active` missed `sessionStatus=running`, causing false completion and premature teardown.

### Full Branch Validation

Path: `.test/runs/2026-04-24_04-09-48-branch-validation/`

| Cycle | Phase | Passed | Failed |
|-------|-------|--------|--------|
| 1 | 1 | 32 | 3 |
| 1 | 2 | 31 | 4 |
| 1 | 3 | 10 | 2 |
| 2 | 1 | 32 | 3 |
| 2 | 2 | 29 | 6 |
| 2 | 3 | 2 | 10 |

### Isolated Phase 2/3 Branch Validation

Path: `.test/runs/2026-04-24_04-45-59-branch-validation/`

| Cycle | Phase | Passed | Failed |
|-------|-------|--------|--------|
| 1 | 2 | 34 | 1 |
| 1 | 3 | 6 | 6 |
| 2 | 2 | 28 | 7 |
| 2 | 3 | 6 | 6 |
| 3 | 2 | 29 | 6 |
| 3 | 3 | 7 | 5 |

## Remaining Bugs

| ID | Stability | Symptom |
|----|-----------|---------|
| B01 | stable | Thinking-stage interrupt / stop then resend loses the expected assistant follow-up, often `total_gte expected 3, got 2`. |
| B02 | stable | `stdinId` interrupt recovery still regresses under repeated stop/resend validation. |
| B03 | repeated | Writing-stage stop then resend can stay in `writing` until `wait-until-done` times out. |
| B04 | repeated | Repeated LLM/interrupt suites leave socket `ping` alive but `status` or `execute-js` timing out. |
| B05 | cascading | After B04, later suites such as `new-session`, `stop`, `switch-model`, and `open-settings` fail through JS execution timeout. |
| B06 | intermittent | Provider persistence can start timing out after earlier interrupt/stream suites. Treat as possibly caused by B04 until isolated. |
| B07 | intermittent | Streaming stress can pass alone but contribute to later bridge timeouts in multi-round validation. |

## Next Fix Task

Trellis task: `.trellis/tasks/04-24-fix-e2e-interrupt-bridge/`

Goal: fix interrupt recovery and bridge degradation before using downstream failures as separate product bugs.
