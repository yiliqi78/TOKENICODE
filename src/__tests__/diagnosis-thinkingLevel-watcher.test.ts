/**
 * Diagnosis: P1 #12 — thinkingLevel runtime change has no effect.
 *
 * settingsStore has a subscribe watcher that sends set_permission_mode
 * to the CLI when sessionMode changes. But there is NO equivalent watcher
 * for thinkingLevel or selectedModel. This means:
 *
 * - User changes thinking level in UI → settingsStore updates
 * - Next follow-up message uses sendStdin (no new process)
 * - CLI process still has the OLD CLAUDE_CODE_EFFORT_LEVEL env var
 * - thinkingLevel change is silently ignored
 *
 * This test verifies the watcher gap by scanning settingsStore source.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const settingsSource = readFileSync(
  resolve(__dirname, '../stores/settingsStore.ts'),
  'utf-8',
);

// Extract the subscribe watcher section (after the store definition)
function extractSubscribeSection(src: string): string {
  const idx = src.indexOf('useSettingsStore.subscribe');
  if (idx === -1) return '';
  return src.slice(idx);
}

const watcherSection = extractSubscribeSection(settingsSource);

describe('P1 #12: thinkingLevel runtime watcher gap', () => {
  it('settingsStore has a subscribe watcher', () => {
    expect(watcherSection.length).toBeGreaterThan(50);
  });

  it('watcher checks sessionMode changes', () => {
    expect(watcherSection).toContain('sessionMode');
    expect(watcherSection).toContain('prevState.sessionMode');
  });

  it('watcher calls setPermissionMode for sessionMode changes', () => {
    expect(watcherSection).toContain('setPermissionMode');
  });

  it('BUG: watcher does NOT check thinkingLevel changes', () => {
    // If a thinkingLevel watcher existed, the subscribe section would
    // contain 'thinkingLevel' in a comparison with prevState
    const hasThinkingWatch = /state\.thinkingLevel\s*!==\s*prevState\.thinkingLevel|thinkingLevel.*prevState/
      .test(watcherSection);
    expect(hasThinkingWatch).toBe(false); // BUG: no watcher
  });

  it('BUG: watcher does NOT check selectedModel changes', () => {
    // If a model watcher existed, it would contain 'selectedModel' comparison
    const hasModelWatch = /state\.selectedModel\s*!==\s*prevState\.selectedModel|selectedModel.*prevState/
      .test(watcherSection);
    expect(hasModelWatch).toBe(false); // BUG: no watcher
  });

  it('bridge.setModel exists but is never called from a watcher', () => {
    // Verify the capability exists in tauri-bridge but isn't wired up
    const bridgeSource = readFileSync(
      resolve(__dirname, '../lib/tauri-bridge.ts'),
      'utf-8',
    );
    expect(bridgeSource).toContain('setModel');

    // But settingsStore never imports or calls it
    expect(settingsSource).not.toContain('setModel');
  });

  it('CLAUDE_CODE_EFFORT_LEVEL is set at spawn time only (lib.rs)', () => {
    // This confirms the env var is process-lifetime scoped
    // We can't read Rust from vitest, but we can verify the TS side
    // doesn't have any runtime effort-level update mechanism

    // No sendControlRequest for effort/thinking in the entire hooks dir
    const hooksDir = resolve(__dirname, '../hooks');
    // useStreamProcessor is the main hooks file
    const processorSource = readFileSync(
      resolve(hooksDir, 'useStreamProcessor.ts'),
      'utf-8',
    );
    // Should not contain any runtime thinking level update
    expect(processorSource).not.toContain('set_thinking_level');
    expect(processorSource).not.toContain('setThinkingLevel');
    // (setThinkingLevel in settingsStore is a store setter, not a CLI command)
  });
});
