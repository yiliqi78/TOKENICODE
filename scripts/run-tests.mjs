#!/usr/bin/env node

// run-tests.mjs — Mechanical test runner for TOKENICODE GUI
// Reads test definitions from JSON, executes them serially via tokenicode-cli.mjs,
// records everything, outputs structured report.
// Zero external dependencies — Node.js built-in modules only.

import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

// ─── Constants ───────────────────────────────────────────────────────────────

const __dirname = dirname(fileURLToPath(import.meta.url));
const CLI_PATH = resolve(__dirname, 'tokenicode-cli.mjs');
const DEFAULT_STEP_TIMEOUT = 30_000;  // 30s per step
const DEFAULT_TEST_TIMEOUT = 120_000; // 2 min per test
const MAX_CONSECUTIVE_FAILURES = 3;   // trigger restart after this many
const REPORT_DIR = process.env.TOKENICODE_REPORT_DIR || '/tmp';
const DETAIL_LEVELS = { minimal: 0, standard: 1, full: 2 };

// ─── CLI Bridge ──────────────────────────────────────────────────────────────

/**
 * Execute a single CLI command. Returns the parsed JSON output.
 * This is the ONLY interface to TOKENICODE — pure process spawn, no socket.
 */
function cli(cmd, args = [], flags = {}, timeout = DEFAULT_STEP_TIMEOUT) {
  const argv = [CLI_PATH, cmd, ...args];
  for (const [k, v] of Object.entries(flags)) {
    argv.push(`--${k}`);
    if (v !== true) argv.push(String(v));
  }

  const start = Date.now();
  try {
    const stdout = execFileSync('node', argv, {
      encoding: 'utf8',
      timeout,
      maxBuffer: 10 * 1024 * 1024, // 10MB for large outputs
      env: { ...process.env },
    });
    const elapsed = Date.now() - start;
    const lines = stdout.trim().split('\n').filter(Boolean);
    const lastLine = lines[lines.length - 1] || '{}';
    try {
      return { ...JSON.parse(lastLine), _elapsed: elapsed };
    } catch {
      return { ok: false, error: `Unparseable CLI output: ${lastLine.slice(0, 200)}`, _elapsed: elapsed };
    }
  } catch (err) {
    const elapsed = Date.now() - start;
    if (err.killed || err.signal === 'SIGTERM') {
      return { ok: false, error: `Command '${cmd}' killed after ${timeout}ms timeout`, _elapsed: elapsed };
    }
    const stdout = (err.stdout || '').trim();
    if (stdout) {
      try {
        return { ...JSON.parse(stdout), _elapsed: elapsed };
      } catch { /* fall through */ }
    }
    return { ok: false, error: err.message?.slice(0, 500) || 'Unknown CLI error', _elapsed: elapsed };
  }
}

/**
 * Capture a status snapshot (lightweight, for recording state transitions).
 */
function captureState() {
  try {
    const result = cli('status', [], {}, 8000);
    if (result.ok) {
      const { ok, _elapsed, ...state } = result;
      return state;
    }
    return { error: result.error };
  } catch {
    return { error: 'status capture failed' };
  }
}

/**
 * Capture visible text from a selector (for recording what the user would see).
 */
function captureVisibleText(selector = '[data-testid=chat-messages]') {
  try {
    const result = cli('get-visible-text', [], { selector }, 8000);
    if (result.ok && result.text) {
      const text = result.text.length > 2000 ? result.text.slice(0, 2000) + '…[truncated]' : result.text;
      return text;
    }
    return null;
  } catch {
    return null;
  }
}

// ─── Schema Validation ───────────────────────────────────────────────────────

/**
 * Validate a step array (steps/setup/teardown). Returns error string or null.
 */
function validateStepArray(steps, testIndex, testName, arrayName) {
  if (!Array.isArray(steps)) {
    return `Test ${testIndex} ("${testName}"): "${arrayName}" must be an array`;
  }
  for (let i = 0; i < steps.length; i++) {
    const s = steps[i];
    if (!s || typeof s !== 'object' || typeof s.cmd !== 'string') {
      return `Test ${testIndex} ${arrayName}[${i}]: must be an object with a "cmd" string`;
    }
  }
  return null;
}

/**
 * Validate a single test definition. Returns null if valid, error string if invalid.
 */
function validateTestDef(testDef, index) {
  if (!testDef || typeof testDef !== 'object') {
    return `Test ${index}: must be an object`;
  }
  const name = testDef.name || 'unnamed';
  if (!Array.isArray(testDef.steps)) {
    return `Test ${index} ("${name}"): "steps" must be an array`;
  }
  if (testDef.steps.length === 0) {
    return `Test ${index} ("${name}"): "steps" must not be empty`;
  }
  // Validate steps, setup, and teardown elements
  const stepsErr = validateStepArray(testDef.steps, index, name, 'steps');
  if (stepsErr) return stepsErr;
  if (testDef.setup) {
    const setupErr = validateStepArray(testDef.setup, index, name, 'setup');
    if (setupErr) return setupErr;
  }
  if (testDef.teardown) {
    const teardownErr = validateStepArray(testDef.teardown, index, name, 'teardown');
    if (teardownErr) return teardownErr;
  }
  return null;
}

// ─── Test Executor ───────────────────────────────────────────────────────────

/**
 * Execute a single test step. Returns a detailed step record.
 * @param {number} remainingBudgetMs - remaining time budget from test timeout (for clamping)
 */
function executeStep(step, stepIndex, phase, captureSnapshots, remainingBudgetMs, detailLevel = 'standard') {
  const record = {
    index: stepIndex,
    phase, // 'setup' | 'step' | 'teardown'
    cmd: step.cmd,
    args: step.args || [],
    flags: step.flags || {},
    startTime: new Date().toISOString(),
    success: false,
    output: null,
    error: null,
    elapsed: 0,
    beforeState: null,
    afterState: null,
    visibleText: null,
  };

  // Pre-step state snapshot (skipped in minimal mode)
  if (captureSnapshots && detailLevel !== 'minimal') {
    record.beforeState = captureState();
  }

  // Clamp step timeout to remaining test budget (testTimeout is a hard limit)
  const stepTimeout = step.timeout || DEFAULT_STEP_TIMEOUT;
  let effectiveTimeout;
  if (remainingBudgetMs != null) {
    if (phase === 'teardown') {
      // Teardown gets at least 3s to clean up, even if test budget is exhausted
      effectiveTimeout = Math.min(stepTimeout, Math.max(remainingBudgetMs, 3000));
    } else {
      // Setup and test steps are strictly clamped. If budget is exhausted, skip.
      effectiveTimeout = Math.min(stepTimeout, Math.max(remainingBudgetMs, 0));
      if (effectiveTimeout <= 0) {
        record.error = 'Test timeout budget exhausted';
        record.endTime = new Date().toISOString();
        return record;
      }
    }
  } else {
    effectiveTimeout = stepTimeout;
  }

  const result = cli(step.cmd, step.args || [], step.flags || {}, effectiveTimeout);
  record.elapsed = result._elapsed || 0;
  record.output = result;
  record.success = !!result.ok;
  if (!result.ok) {
    record.error = result.error || 'Command returned ok:false';
  }

  // Step-level assertions: check output fields against expected values.
  // Supports exact match (key), gte (key_gte), lte (key_lte), contains (key_contains).
  if (step.assert && typeof step.assert === 'object' && record.success) {
    const assertErrors = [];
    for (const [key, expected] of Object.entries(step.assert)) {
      let field, cmp;
      if (key.endsWith('_gte'))           { field = key.slice(0, -4); cmp = 'gte'; }
      else if (key.endsWith('_lte'))      { field = key.slice(0, -4); cmp = 'lte'; }
      else if (key.endsWith('_contains')) { field = key.slice(0, -9); cmp = 'contains'; }
      else                                { field = key; cmp = 'eq'; }
      const actual = result[field];
      let passed;
      switch (cmp) {
        case 'eq':       passed = actual === expected; break;
        case 'gte':      passed = actual >= expected; break;
        case 'lte':      passed = actual <= expected; break;
        case 'contains': passed = typeof actual === 'string' && actual.includes(String(expected)); break;
      }
      if (!passed) assertErrors.push(`${key}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
    }
    if (assertErrors.length) {
      record.success = false;
      record.error = `Assertion failed: ${assertErrors.join('; ')}`;
    }
  }

  // Post-step state snapshot + visible text for UI-changing commands
  // Detail levels: minimal (no snapshots), standard (state snapshots), full (snapshots + visible text always)
  if (captureSnapshots && detailLevel !== 'minimal') {
    record.afterState = captureState();
    if (detailLevel === 'full') {
      // Full: capture visible text on every step
      record.visibleText = captureVisibleText();
    } else {
      // Standard: capture visible text only for UI-changing commands
      const uiChangingCmds = new Set(['send', 'type', 'switch-session', 'switch-model', 'switch-provider',
        'allow-permission', 'deny-permission', 'open-settings', 'close-settings', 'new-session', 'restart']);
      if (uiChangingCmds.has(step.cmd)) {
        record.visibleText = captureVisibleText();
      }
    }
  }

  record.endTime = new Date().toISOString();
  return record;
}

/**
 * Execute a single test (all its steps). Returns a test record.
 * Handles retries at the test level. All attempt histories are preserved.
 */
function executeTest(testDef, testIndex, globalConfig) {
  const maxRetries = testDef.retry ?? globalConfig.retry ?? 0;
  const captureSnapshots = testDef.captureSnapshots ?? globalConfig.captureSnapshots ?? true;
  const testTimeout = testDef.timeout || globalConfig.testTimeout || DEFAULT_TEST_TIMEOUT;
  const detailLevel = globalConfig.detailLevel || 'standard';

  const testRecord = {
    index: testIndex,
    name: testDef.name || `Test ${testIndex + 1}`,
    status: 'pending',
    totalAttempts: 0,
    maxRetries,
    elapsed: 0,
    // All attempt histories are preserved (fixes "retry history lost" issue)
    attempts: [],
    // steps = the final (last) attempt's steps (for backwards compatibility)
    steps: [],
    error: null,
    startTime: new Date().toISOString(),
    endTime: null,
  };

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    testRecord.totalAttempts = attempt + 1;
    const testStart = Date.now();
    const stepRecords = [];
    let testPassed = true;
    let aborted = false;
    let attemptError = null;

    // Run setup steps (if any)
    if (testDef.setup) {
      for (let i = 0; i < testDef.setup.length; i++) {
        const remaining = testTimeout - (Date.now() - testStart);
        const setupRecord = executeStep(testDef.setup[i], i, 'setup', captureSnapshots, remaining, detailLevel);
        stepRecords.push(setupRecord);
        if (!setupRecord.success) {
          attemptError = `Setup step ${i} failed: ${setupRecord.error}`;
          testPassed = false;
          break;
        }
      }
    }

    // Run test steps
    if (testPassed) {
      for (let i = 0; i < testDef.steps.length; i++) {
        const elapsed = Date.now() - testStart;
        if (elapsed > testTimeout) {
          attemptError = `Test timed out after ${testTimeout}ms at step ${i}`;
          testPassed = false;
          aborted = true;
          break;
        }

        const remaining = testTimeout - elapsed;
        const stepRecord = executeStep(testDef.steps[i], i, 'step', captureSnapshots, remaining, detailLevel);
        stepRecords.push(stepRecord);

        if (!stepRecord.success && !testDef.steps[i].continueOnError) {
          attemptError = `Step ${i} (${testDef.steps[i].cmd}) failed: ${stepRecord.error}`;
          testPassed = false;
          break;
        }
      }
    }

    // Run teardown steps (always run, even on failure)
    let teardownFailed = false;
    if (testDef.teardown) {
      for (let i = 0; i < testDef.teardown.length; i++) {
        const remaining = testTimeout - (Date.now() - testStart);
        const teardownRecord = executeStep(testDef.teardown[i], i, 'teardown', false, remaining, detailLevel);
        stepRecords.push(teardownRecord);
        if (!teardownRecord.success) teardownFailed = true;
      }
    }

    const attemptRecord = {
      attempt: attempt + 1,
      passed: testPassed,
      elapsed: Date.now() - testStart,
      error: attemptError,
      teardownFailed,
      steps: stepRecords,
    };
    testRecord.attempts.push(attemptRecord);

    if (testPassed) {
      testRecord.status = 'pass';
      testRecord.error = null; // Clear error from previous attempts
      testRecord.steps = stepRecords;
      testRecord.elapsed = attemptRecord.elapsed;
      break;
    }

    if (aborted) {
      testRecord.status = 'fail';
      testRecord.error = attemptError;
      testRecord.steps = stepRecords;
      testRecord.elapsed = attemptRecord.elapsed;
      break;
    }

    // If we have more retries, log and continue
    if (attempt < maxRetries) {
      process.stderr.write(`[run-tests] Test "${testRecord.name}" attempt ${attempt + 1} failed, retrying...\n`);
    } else {
      testRecord.status = 'fail';
      testRecord.error = attemptError;
      testRecord.steps = stepRecords;
      testRecord.elapsed = attemptRecord.elapsed;
    }
  }

  testRecord.endTime = new Date().toISOString();
  return testRecord;
}

// ─── Report Builder ──────────────────────────────────────────────────────────

function buildReport(testRecords, config, startTime) {
  const endTime = new Date();
  const passed = testRecords.filter(t => t.status === 'pass').length;
  const failed = testRecords.filter(t => t.status === 'fail').length;
  const skipped = testRecords.filter(t => t.status === 'skipped').length;

  // Extract issues: failed tests + tests where teardown failed (even if test passed)
  const issues = [];
  for (const t of testRecords) {
    if (t.status === 'fail') {
      const failStep = t.steps.find(s => !s.success);
      issues.push({
        test: t.name,
        testIndex: t.index,
        type: 'test_failure',
        attempts: t.totalAttempts,
        error: t.error,
        failedStep: failStep ? {
          index: failStep.index,
          phase: failStep.phase,
          cmd: failStep.cmd,
          args: failStep.args,
          error: failStep.error,
          output: failStep.output,
          beforeState: failStep.beforeState,
          afterState: failStep.afterState,
          visibleText: failStep.visibleText,
        } : null,
      });
    }
    // Also report teardown failures (state pollution risk for subsequent tests)
    const lastAttempt = t.attempts?.[t.attempts.length - 1];
    if (lastAttempt?.teardownFailed) {
      const teardownFail = lastAttempt.steps.find(s => s.phase === 'teardown' && !s.success);
      if (teardownFail) {
        issues.push({
          test: t.name,
          testIndex: t.index,
          type: 'teardown_failure',
          error: `Teardown failed: ${teardownFail.error}`,
          failedStep: {
            index: teardownFail.index,
            phase: 'teardown',
            cmd: teardownFail.cmd,
            args: teardownFail.args,
            error: teardownFail.error,
            output: teardownFail.output,
          },
        });
      }
    }
  }

  return {
    meta: {
      startTime: startTime.toISOString(),
      endTime: endTime.toISOString(),
      elapsed: endTime - startTime,
      totalTests: testRecords.length,
      passed,
      failed,
      skipped,
      config: {
        testFile: config._testFile || null,
        captureSnapshots: config.captureSnapshots ?? true,
        retry: config.retry ?? 0,
      },
    },
    issues,
    tests: testRecords,
  };
}

// ─── Main Runner ─────────────────────────────────────────────────────────────

function parseRunnerArgs() {
  const args = process.argv.slice(2);
  const config = {
    testFile: null,
    reportPath: null,
    captureSnapshots: true,
    retry: 0,
    testTimeout: DEFAULT_TEST_TIMEOUT,
    stopOnConsecutiveFailures: MAX_CONSECUTIVE_FAILURES,
    autoRestart: true,
    detailLevel: 'standard', // minimal | standard | full
  };

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--report') {
      config.reportPath = args[++i];
    } else if (args[i] === '--no-snapshots') {
      config.captureSnapshots = false;
    } else if (args[i] === '--retry') {
      config.retry = parseInt(args[++i]) || 0;
    } else if (args[i] === '--test-timeout') {
      config.testTimeout = parseInt(args[++i]) || DEFAULT_TEST_TIMEOUT;
    } else if (args[i] === '--stop-after') {
      config.stopOnConsecutiveFailures = parseInt(args[++i]) || MAX_CONSECUTIVE_FAILURES;
    } else if (args[i] === '--no-auto-restart') {
      config.autoRestart = false;
    } else if (args[i] === '--detail') {
      const level = args[++i];
      if (level in DETAIL_LEVELS) config.detailLevel = level;
      else { process.stderr.write(`Invalid detail level: ${level}. Use minimal|standard|full\n`); process.exit(1); }
    } else if (!args[i].startsWith('--')) {
      config.testFile = args[i];
    }
  }

  return config;
}

function main() {
  const config = parseRunnerArgs();

  if (!config.testFile) {
    process.stderr.write('Usage: node scripts/run-tests.mjs <test-file.json> [--report path] [--retry N] [--no-snapshots]\n');
    process.exit(1);
  }

  // Read and validate test definitions
  let testDefs;
  try {
    const raw = readFileSync(resolve(config.testFile), 'utf8');
    testDefs = JSON.parse(raw);
    // Support both array and object-with-tests format
    if (!Array.isArray(testDefs)) {
      if (testDefs.tests && Array.isArray(testDefs.tests)) {
        if (testDefs.retry != null) config.retry = testDefs.retry;
        if (testDefs.captureSnapshots != null) config.captureSnapshots = testDefs.captureSnapshots;
        if (testDefs.testTimeout != null) config.testTimeout = testDefs.testTimeout;
        testDefs = testDefs.tests;
      } else {
        testDefs = [testDefs];
      }
    }
  } catch (err) {
    process.stderr.write(`Failed to read test file: ${err.message}\n`);
    process.exit(1);
  }

  // Schema validation
  for (let i = 0; i < testDefs.length; i++) {
    const validationError = validateTestDef(testDefs[i], i);
    if (validationError) {
      process.stderr.write(`[run-tests] Invalid test definition: ${validationError}\n`);
      process.stdout.write(JSON.stringify({ _summary: true, total: 0, passed: 0, failed: 0, skipped: 0, elapsed: 0, error: validationError }) + '\n');
      process.exit(1);
    }
  }

  config._testFile = config.testFile;

  // Pre-flight: check if TOKENICODE is running
  const pingResult = cli('ping');
  if (!pingResult.ok) {
    process.stderr.write(`TOKENICODE is not running. Start with: pnpm tauri dev\n`);
    process.stderr.write(`Ping result: ${JSON.stringify(pingResult)}\n`);
    process.exit(1);
  }

  process.stderr.write(`[run-tests] Starting ${testDefs.length} test(s)...\n`);

  const startTime = new Date();
  const testRecords = [];
  let consecutiveFailures = 0;
  let abortedByBailout = false;

  for (let i = 0; i < testDefs.length; i++) {
    const testDef = testDefs[i];
    process.stderr.write(`[run-tests] [${i + 1}/${testDefs.length}] ${testDef.name || `Test ${i + 1}`}...\n`);

    const testRecord = executeTest(testDef, i, config);
    testRecords.push(testRecord);

    // Stdout summary line (one per test, for AI context)
    const summary = {
      test: testRecord.name,
      status: testRecord.status,
      elapsed: testRecord.elapsed,
      attempts: testRecord.totalAttempts,
    };
    if (testRecord.status === 'fail') {
      summary.error = testRecord.error;
    }
    process.stdout.write(JSON.stringify(summary) + '\n');

    // Track consecutive failures for bailout
    if (testRecord.status === 'fail') {
      consecutiveFailures++;

      if (config.autoRestart && consecutiveFailures >= config.stopOnConsecutiveFailures) {
        process.stderr.write(`[run-tests] ${consecutiveFailures} consecutive failures — attempting restart...\n`);
        let restartResult = cli('restart', [], {}, 30_000);
        if (!restartResult.ok) {
          process.stderr.write(`[run-tests] restart failed, escalating to relaunch...\n`);
          restartResult = cli('relaunch', [], {}, 120_000);
        }

        if (restartResult.ok) {
          process.stderr.write(`[run-tests] Recovery successful (${restartResult._elapsed || restartResult.elapsed}ms). Continuing tests...\n`);
          consecutiveFailures = 0;
        } else {
          process.stderr.write(`[run-tests] Recovery failed: ${restartResult.error}. Aborting remaining tests.\n`);
          abortedByBailout = true;

          for (let j = i + 1; j < testDefs.length; j++) {
            testRecords.push({
              index: j,
              name: testDefs[j].name || `Test ${j + 1}`,
              status: 'skipped',
              totalAttempts: 0,
              elapsed: 0,
              attempts: [],
              steps: [],
              error: 'Skipped: runner aborted after restart failure',
              startTime: new Date().toISOString(),
              endTime: new Date().toISOString(),
            });
          }
          break;
        }
      }
    } else {
      consecutiveFailures = 0;
    }
  }

  // Build and save report
  const report = buildReport(testRecords, config, startTime);

  if (abortedByBailout) {
    report.meta.aborted = true;
    report.meta.abortReason = 'Restart failed after consecutive test failures';
  }

  // Determine report path
  const timestamp = startTime.toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const reportPath = config.reportPath || resolve(REPORT_DIR, `tokenicode-test-report-${timestamp}.json`);

  let reportWritten = false;
  let reportWriteError = null;
  try {
    mkdirSync(dirname(reportPath), { recursive: true });
    writeFileSync(reportPath, JSON.stringify(report, null, 2), 'utf8');
    reportWritten = true;
  } catch (err) {
    reportWriteError = err.message;
    process.stderr.write(`[run-tests] Failed to write report: ${err.message}\n`);
  }

  // Final summary to stdout
  process.stdout.write(JSON.stringify({
    _summary: true,
    total: report.meta.totalTests,
    passed: report.meta.passed,
    failed: report.meta.failed,
    skipped: report.meta.skipped,
    elapsed: report.meta.elapsed,
    reportPath: reportWritten ? reportPath : null,
    reportWritten,
    reportWriteError,
    aborted: !!report.meta.aborted,
  }) + '\n');

  process.stderr.write(`[run-tests] Done. ${report.meta.passed}/${report.meta.totalTests} passed. Report: ${reportWritten ? reportPath : 'FAILED TO WRITE'}\n`);

  if (report.meta.failed > 0 || report.meta.aborted) {
    process.exit(1);
  }
}

main();
