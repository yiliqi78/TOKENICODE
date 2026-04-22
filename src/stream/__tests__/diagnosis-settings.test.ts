/**
 * Diagnosis tests: settingsStore model migration + provider parameter injection
 *
 * Validates:
 * - v7 migration forces 4.6 → 4.7 (breaks old CLI users)
 * - ThinkingLevel lacks 'xhigh'
 * - Provider preset thinkingSupport accuracy
 */
import { describe, it, expect } from 'vitest';

// We can't import settingsStore directly (it uses zustand persist + localStorage)
// Instead, test the migration logic and type definitions by examining source.

describe('Root Cause 3: Model/CLI version compatibility', () => {
  it('MODEL_OPTIONS only contains Opus 4.7, not 4.6 variants', () => {
    // Simulate what MODEL_OPTIONS contains on main
    const MODEL_OPTIONS = [
      { id: 'claude-opus-4-7', label: 'Claude Opus 4.7', short: 'Opus 4.7' },
      { id: 'claude-sonnet-4-6', label: 'Claude Sonnet 4.6', short: 'Sonnet 4.6' },
      { id: 'claude-haiku-4-5-20251001', label: 'Claude Haiku 4.5', short: 'Haiku 4.5' },
    ];

    const has46 = MODEL_OPTIONS.some(m => m.id.includes('4-6') && m.id.includes('opus'));
    const has47 = MODEL_OPTIONS.some(m => m.id === 'claude-opus-4-7');

    expect(has46).toBe(false); // 4.6 removed
    expect(has47).toBe(true);  // 4.7 present
  });

  it('v7 migration forces 4.6 users to 4.7 — potential breakage for old CLI', () => {
    // Simulate the v7 migration logic from settingsStore.ts:296-305
    function migrateV7(persisted: { selectedModel: string }) {
      if (
        persisted.selectedModel === 'claude-opus-4-6' ||
        persisted.selectedModel === 'claude-opus-4-6-1m'
      ) {
        persisted.selectedModel = 'claude-opus-4-7';
      }
      return persisted;
    }

    // User was on 4.6
    const result1 = migrateV7({ selectedModel: 'claude-opus-4-6' });
    expect(result1.selectedModel).toBe('claude-opus-4-7');

    // User was on 4.6-1m
    const result2 = migrateV7({ selectedModel: 'claude-opus-4-6-1m' });
    expect(result2.selectedModel).toBe('claude-opus-4-7');

    // PROBLEM: if CLI 2.1.92 doesn't know 'claude-opus-4-7', this will cause:
    // - CLI error at session start
    // - User stuck with no way to switch back (UI only shows 4.7)
  });

  it('ThinkingLevel type does NOT include xhigh', () => {
    type ThinkingLevel = 'off' | 'low' | 'medium' | 'high' | 'max';
    const levels: ThinkingLevel[] = ['off', 'low', 'medium', 'high', 'max'];

    // xhigh is Opus 4.7's default but not in the type
    expect(levels).not.toContain('xhigh');
    expect(levels.length).toBe(5);
  });
});

describe('Root Cause 5: Provider parameter white-list gaps', () => {
  it('documents which env vars are injected unconditionally', () => {
    // These are injected for ALL providers regardless of compatibility
    const unconditionalEnvVars = [
      'CLAUDE_CODE_EFFORT_LEVEL',         // thinking_level != "off"
      'CLAUDE_CODE_MAX_OUTPUT_TOKENS',     // always 64000
      'CLAUDE_CODE_ENABLE_SDK_FILE_CHECKPOINTING', // always 1
    ];

    // These are conditional (kept as documentation; not asserted on directly)
    void [
      'CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS', // non-Anthropic only
      'CLAUDE_CODE_AUTO_COMPACT_WINDOW',         // 1M models only
    ];

    // Known provider limitations that conflict with unconditional injection:
    const knownConflicts = [
      {
        provider: '智谱 GLM',
        conflict: 'CLAUDE_CODE_EFFORT_LEVEL',
        reason: 'thinking budget_tokens 上限 38912, high/max effort 可能超限',
      },
      {
        provider: '第三方中转',
        conflict: 'CLAUDE_CODE_MAX_OUTPUT_TOKENS=64000',
        reason: '某些 Provider 限 32768, 设 64000 会 400',
      },
    ];

    expect(unconditionalEnvVars.length).toBe(3);
    expect(knownConflicts.length).toBeGreaterThan(0);
  });

  it('Haiku effort clamp logic', () => {
    // Simulate lib.rs:1349 Haiku clamp
    function clampEffort(modelName: string, thinkingLevel: string): string {
      const modelLower = modelName.toLowerCase();
      if (modelLower.includes('haiku') && thinkingLevel !== 'off' && thinkingLevel !== 'low') {
        return 'low';
      }
      return thinkingLevel;
    }

    expect(clampEffort('claude-haiku-4-5-20251001', 'high')).toBe('low');
    expect(clampEffort('claude-haiku-4-5-20251001', 'max')).toBe('low');
    expect(clampEffort('claude-haiku-4-5-20251001', 'low')).toBe('low');
    expect(clampEffort('claude-haiku-4-5-20251001', 'off')).toBe('off');
    expect(clampEffort('claude-opus-4-7', 'max')).toBe('max'); // non-haiku unchanged
  });

  it('DISABLE_EXPERIMENTAL_BETAS condition', () => {
    // Simulate lib.rs:1042-1054
    function shouldDisableBetas(baseUrl: string): boolean {
      const baseLower = baseUrl.toLowerCase();
      const isNativeAnthropic = baseLower === '' || baseLower.includes('api.anthropic.com');
      return !isNativeAnthropic;
    }

    expect(shouldDisableBetas('')).toBe(false);                    // default = Anthropic
    expect(shouldDisableBetas('https://api.anthropic.com')).toBe(false);
    expect(shouldDisableBetas('https://open.bigmodel.cn')).toBe(true);  // 智谱
    expect(shouldDisableBetas('https://api.moonshot.cn')).toBe(true);   // Kimi
    expect(shouldDisableBetas('https://openrouter.ai')).toBe(true);
    expect(shouldDisableBetas('https://bedrock-runtime.us-east-1.amazonaws.com')).toBe(true);
  });
});

describe('Root Cause 2: AskUserQuestion dual-path race', () => {
  it('documents the two paths and their timing dependency', () => {
    // Path A: assistant message with tool_use block
    const pathA_message = {
      type: 'assistant',
      message: {
        content: [
          { type: 'tool_use', id: 'toolu_01abc', name: 'AskUserQuestion', input: { questions: [] } }
        ]
      }
    };

    // Path B: control_request intercepted by Rust, forwarded as tokenicode_permission_request
    const pathB_event = {
      type: 'tokenicode_permission_request',
      tool_name: 'AskUserQuestion',
      request_id: 'req_001',
      tool_use_id: 'toolu_01abc',  // should match Path A's block.id
      input: { questions: [] },
    };

    // If Path A creates QuestionCard with id='toolu_01abc'
    // and Path B searches for id='toolu_01abc', they should match
    const cardId = pathA_message.message.content[0].id;
    const searchId = pathB_event.tool_use_id;
    expect(cardId).toBe(searchId); // IDs match → patch succeeds

    // BUG: But what if tool_use_id in control_request is undefined or different?
    void { ...pathB_event, tool_use_id: undefined };
    // Search falls back to: messages.find(m => m.type === 'question' && !m.resolved && m.toolName === 'AskUserQuestion')
    // This fallback SHOULD work... unless there are multiple unresolved questions
  });

  it('awaitingSdkPatch blocks interaction when permissionData is missing', () => {
    // Simulate QuestionCard.tsx:92
    function isBlocked(resolved: boolean, permissionData: { requestId?: string } | undefined): boolean {
      return !resolved && !permissionData?.requestId;
    }

    // Path A created card without permissionData → blocked
    expect(isBlocked(false, undefined)).toBe(true);
    expect(isBlocked(false, {})).toBe(true);
    expect(isBlocked(false, { requestId: undefined })).toBe(true);

    // Path B patched permissionData → unblocked
    expect(isBlocked(false, { requestId: 'req_001' })).toBe(false);

    // Already resolved → not blocked regardless
    expect(isBlocked(true, undefined)).toBe(false);
  });
});
