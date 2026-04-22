/**
 * Diagnosis: P0 #4 — watchdog was removed (Phase 1 lifecycle fix).
 *
 * Previously App.tsx had a watchdog in attemptRecovery that called
 * bridge.startSession() without registering listeners. The fix was
 * to delete the watchdog entirely (§5.8) because it never recovered
 * successfully and the lifecycle fixes address root causes.
 *
 * This test verifies:
 * 1. The watchdog code is completely removed from App.tsx
 * 2. InputBar's spawn path uses the lifecycle module (spawnSession)
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const appSource = readFileSync(
  resolve(__dirname, '../App.tsx'),
  'utf-8',
);

describe('P0 #4: watchdog removal (Phase 1 fix)', () => {
  it('FIXED: attemptRecovery function no longer exists in App.tsx', () => {
    expect(appSource).not.toContain('const attemptRecovery');
    expect(appSource).not.toContain('STALL_THRESHOLD_MS');
  });

  it('FIXED: watchdog timer no longer exists in App.tsx', () => {
    expect(appSource).not.toContain('const tick');
    // The watchdog comment should be replaced with removal notice
    expect(appSource).toContain('Watchdog removed');
  });

  it('InputBar spawn path uses lifecycle module (spawnSession)', () => {
    const inputBarSource = readFileSync(
      resolve(__dirname, '../components/chat/InputBar.tsx'),
      'utf-8',
    );
    // InputBar should import from sessionLifecycle
    expect(inputBarSource).toContain("from '../../lib/sessionLifecycle'");
    // The spawn section should use spawnSession instead of direct bridge.startSession
    expect(inputBarSource).toContain('spawnSession');
  });
});
