/**
 * Session recovery: inspect the CLI's on-disk JSONL to decide how to
 * recover from a stalled stream.
 *
 * Called by the global watchdog (App.tsx) when a tab has been stuck in
 * 'running' for longer than the stall threshold. The watchdog uses the
 * returned RecoveryDecision to choose between:
 *   - Resuming the CLI session via `--resume` (most common)
 *   - Finalizing the tab as idle (if the assistant turn actually completed)
 *   - Surfacing an error (if JSONL is missing / unreadable / malformed)
 *
 * This module performs NO side effects — it only reads and classifies.
 */

import { bridge } from './tauri-bridge';

export type RecoveryDecision =
  | {
      kind: 'resume';
      cliResumeId: string;
      reason: string;
    }
  | {
      kind: 'finalize';
      reason: string;
    }
  | {
      kind: 'fail';
      reason: string;
    };

export interface RecoveryInput {
  /** The CLI's own session UUID, used for `--resume <id>`. */
  cliResumeId: string | null;
  /** Absolute path to the CLI-managed JSONL file for this session. */
  sessionPath: string | null;
}

/**
 * Load the last non-trivial message from JSONL and classify the session state.
 *
 * Decision matrix:
 *
 *   Last message type          | stop_reason       | Decision
 *   ---------------------------|-------------------|----------
 *   assistant                  | end_turn          | finalize (already done)
 *   assistant                  | stop_sequence     | finalize (already done)
 *   assistant                  | tool_use          | resume (CLI interrupted mid-tool)
 *   assistant                  | null / unknown    | resume (API stream was truncated)
 *   user (incl. tool_result)   | —                 | resume (CLI hadn't replied yet)
 *   (no eligible message)      | —                 | fail
 *
 * Note on the `assistant + end_turn` case: even though the turn appears
 * complete, the watchdog still fired because the UI never received the
 * `result` event. Finalizing the tab to 'idle' is the right call — the
 * user can send a new message and a fresh CLI process will spawn.
 */
export async function inspectSessionForRecovery(
  input: RecoveryInput,
): Promise<RecoveryDecision> {
  if (!input.cliResumeId) {
    return { kind: 'fail', reason: 'no cliResumeId (session has not yet received CLI UUID)' };
  }
  if (!input.sessionPath) {
    return { kind: 'fail', reason: 'no session path on disk' };
  }

  let rawMessages: any[];
  try {
    rawMessages = await bridge.loadSession(input.sessionPath);
  } catch (e) {
    return { kind: 'fail', reason: `loadSession failed: ${String(e)}` };
  }

  if (!Array.isArray(rawMessages) || rawMessages.length === 0) {
    return { kind: 'fail', reason: 'empty or invalid JSONL' };
  }

  // Walk backwards and find the last assistant or user message.
  // Skip auxiliary entries (file-history-snapshot, queue-operation, etc.).
  let last: any = null;
  for (let i = rawMessages.length - 1; i >= 0; i--) {
    const m = rawMessages[i];
    if (m?.type === 'assistant' || m?.type === 'user') {
      last = m;
      break;
    }
  }

  if (!last) {
    return { kind: 'fail', reason: 'no assistant/user message found in JSONL' };
  }

  if (last.type === 'assistant') {
    const stopReason: string | null | undefined = last.message?.stop_reason;

    // Fully completed turn — the result event must have been lost, but
    // nothing needs resuming. Finalizing to idle lets the user send next.
    if (stopReason === 'end_turn' || stopReason === 'stop_sequence') {
      return {
        kind: 'finalize',
        reason: `assistant turn already complete (stop_reason=${stopReason})`,
      };
    }

    // tool_use: the CLI was mid tool-call when it stalled — resume picks
    // up where it left off (CLI will re-issue the tool or continue).
    // null / unknown: API stream was truncated mid-text. Resume will
    // regenerate the assistant turn cleanly.
    return {
      kind: 'resume',
      cliResumeId: input.cliResumeId,
      reason: `incomplete assistant (stop_reason=${stopReason ?? 'null'})`,
    };
  }

  // last.type === 'user' — the user (or a tool_result) was the tail, so
  // the CLI never produced a reply before it stalled. Resume will make
  // the CLI generate the reply it owes.
  return {
    kind: 'resume',
    cliResumeId: input.cliResumeId,
    reason: 'last message is user/tool_result — CLI never replied',
  };
}
