import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const inputBarSource = readFileSync(
  resolve(__dirname, '../components/chat/InputBar.tsx'),
  'utf-8',
);

const tiptapEditorSource = readFileSync(
  resolve(__dirname, '../components/chat/TiptapEditor.tsx'),
  'utf-8',
);

describe('stopping submit guard regressions', () => {
  it('guards busy follow-ups before the running transition', () => {
    const gateIndex = inputBarSource.indexOf('if (existingStdinId && isSessionBusy(currentStatus)) {');
    const runningIndex = inputBarSource.indexOf("setSessionStatus(tabId, 'running');", gateIndex);

    expect(gateIndex).toBeGreaterThan(-1);
    expect(runningIndex).toBeGreaterThan(gateIndex);
  });

  it('blocks Enter while the session is stopping', () => {
    expect(inputBarSource).toMatch(
      /if \(isStopping\) \{\s+e\.preventDefault\(\);\s+return true;\s+\}/,
    );
  });

  it('disables the send button while stopping', () => {
    expect(inputBarSource).toContain(
      'disabled={isAwaiting || isStopping || (!input.trim() && !activePrefix)}',
    );
  });

  it('passes stopping state into the editor editable guard', () => {
    expect(inputBarSource).toContain('editable={!isStopping}');
    expect(tiptapEditorSource).toContain('editable?: boolean;');
    expect(tiptapEditorSource).toContain('editor.setEditable(editable);');
  });
});
