/**
 * Diagnosis: P0 #4 — watchdog resume missing event listener registration.
 *
 * The watchdog in App.tsx attemptRecovery calls bridge.startSession() to
 * resume a stalled CLI process, but never calls onClaudeStream() or
 * onClaudeStderr() to listen for the new process's output events.
 *
 * This test verifies the bug exists by scanning the actual source code
 * of App.tsx's attemptRecovery function. If the bug is fixed, the test
 * labeled "FIXED" will pass and the "BUG" test will fail.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const appSource = readFileSync(
  resolve(__dirname, '../App.tsx'),
  'utf-8',
);

// Extract the attemptRecovery function body (between "const attemptRecovery" and the next top-level const/useEffect)
function extractAttemptRecovery(source: string): string {
  const startMarker = 'const attemptRecovery';
  const startIdx = source.indexOf(startMarker);
  if (startIdx === -1) return '';

  // Find the closing of attemptRecovery — it ends at "const tick" or "};",
  // whichever marks the end of the async function
  const tickMarker = 'const tick';
  const tickIdx = source.indexOf(tickMarker, startIdx);
  if (tickIdx === -1) return source.slice(startIdx);
  return source.slice(startIdx, tickIdx);
}

const recoveryCode = extractAttemptRecovery(appSource);

describe('P0 #4: watchdog attemptRecovery listener registration', () => {
  it('attemptRecovery function exists in App.tsx', () => {
    expect(recoveryCode.length).toBeGreaterThan(100);
    expect(recoveryCode).toContain('bridge.startSession');
  });

  it('BUG: attemptRecovery does NOT call onClaudeStream', () => {
    // This test documents the bug. When fixed, this test should be updated.
    expect(recoveryCode).not.toContain('onClaudeStream');
  });

  it('BUG: attemptRecovery does NOT call onClaudeStderr', () => {
    expect(recoveryCode).not.toContain('onClaudeStderr');
  });

  it('attemptRecovery calls registerStdinTab (mapping exists)', () => {
    // The stdinId→tab mapping IS registered, so the stream controller
    // would route correctly IF events were being listened to.
    expect(recoveryCode).toContain('registerStdinTab');
  });

  it('for comparison: normal spawn path (InputBar) DOES register listeners', () => {
    // Verify that InputBar's spawn path calls onClaudeStream before startSession
    const inputBarSource = readFileSync(
      resolve(__dirname, '../components/chat/InputBar.tsx'),
      'utf-8',
    );
    // Find the spawn section (between preGeneratedId and startSession)
    const preGenIdx = inputBarSource.indexOf('preGeneratedId');
    const startSessionIdx = inputBarSource.indexOf('bridge.startSession', preGenIdx);
    if (preGenIdx !== -1 && startSessionIdx !== -1) {
      const spawnSection = inputBarSource.slice(preGenIdx, startSessionIdx);
      expect(spawnSection).toContain('onClaudeStream');
    }
  });
});
