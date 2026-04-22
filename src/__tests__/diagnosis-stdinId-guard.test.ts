/**
 * Diagnosis: P0 #1 — process_exit handler missing stdinId ownership guard.
 *
 * Both foreground and background process_exit handlers in useStreamProcessor.ts
 * set the tab to 'idle' and clear stdinId without checking if the exiting
 * process (msg.__stdinId) matches the tab's current active process.
 *
 * This test scans the actual source code to verify the guard is missing.
 * When fixed, the "BUG" tests will fail (update them to "FIXED").
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const source = readFileSync(
  resolve(__dirname, '../hooks/useStreamProcessor.ts'),
  'utf-8',
);

// Extract the foreground process_exit case block (it's ~150 lines, take generous range)
function extractProcessExitForeground(src: string): string {
  const handleStreamIdx = src.indexOf('const handleStreamMessage = useCallback');
  if (handleStreamIdx === -1) return '';
  const exitIdx = src.indexOf("case 'process_exit'", handleStreamIdx);
  if (exitIdx === -1) return '';
  // The foreground handler's process_exit ends at "default:" or the next top-level case
  const defaultIdx = src.indexOf('default:', exitIdx);
  const blockEnd = defaultIdx !== -1 ? defaultIdx : exitIdx + 6000;
  return src.slice(exitIdx, blockEnd);
}

// Extract the background process_exit case block
function extractProcessExitBackground(src: string): string {
  const bgHandlerIdx = src.indexOf('const handleBackgroundStreamMessage');
  if (bgHandlerIdx === -1) return '';
  const exitIdx = src.indexOf("case 'process_exit'", bgHandlerIdx);
  if (exitIdx === -1) return '';
  // Background process_exit ends at "case 'system'" or similar
  const nextCase = src.indexOf("case 'system'", exitIdx);
  const blockEnd = nextCase !== -1 ? nextCase : exitIdx + 3000;
  return src.slice(exitIdx, blockEnd);
}

const fgExit = extractProcessExitForeground(source);
const bgExit = extractProcessExitBackground(source);

describe('P0 #1: process_exit stdinId ownership guard', () => {
  it('foreground process_exit handler exists', () => {
    // The handler uses a local alias: setSessionStatus → cs.setSessionStatus
    // Check for the idle string and stdinId clearing pattern
    expect(fgExit).toContain("'idle'");
    expect(fgExit).toContain('stdinId: undefined');
  });

  it('background process_exit handler exists', () => {
    expect(bgExit).toContain("'idle'");
    expect(bgExit).toContain('stdinId: undefined');
  });

  it('BUG: foreground handler does NOT check stdinId ownership before setting idle', () => {
    // A proper guard would look like:
    // if (tab.stdinId && msg.__stdinId && tab.stdinId !== msg.__stdinId) return;
    //
    // We check for the absence of this pattern. The handler directly calls
    // setSessionStatus('idle') without comparing stdinIds.

    // Look for any comparison between current tab stdinId and msg stdinId
    const hasOwnershipCheck = /stdinId\s*!==\s*msg\.__stdinId|msg\.__stdinId\s*!==.*stdinId/
      .test(fgExit);
    expect(hasOwnershipCheck).toBe(false); // BUG: no check exists
  });

  it('BUG: background handler does NOT check stdinId ownership before setting idle', () => {
    const hasOwnershipCheck = /stdinId\s*!==\s*msg\.__stdinId|msg\.__stdinId\s*!==.*stdinId/
      .test(bgExit);
    expect(hasOwnershipCheck).toBe(false); // BUG: no check exists
  });

  it('foreground tabId resolution falls back to activeTabId when stdinToTab has no mapping', () => {
    // This is the root cause: when old process exit arrives after unregister,
    // ownerTabId is undefined, so tabId = ownerTabId || activeTabId → wrong tab
    const routingSection = source.slice(
      source.indexOf('const handleStreamMessage = useCallback'),
      source.indexOf("case 'tokenicode_permission_request'") > 0
        ? source.indexOf("if (msg.type === 'tokenicode_permission_request')")
        : source.indexOf("case 'tokenicode_permission_request'"),
    );
    // The fallback: tabId = ownerTabId || activeTabId
    expect(routingSection).toContain('ownerTabId || activeTabId');
  });
});
