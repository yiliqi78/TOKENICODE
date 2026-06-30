/**
 * Model-to-context-window mapping.
 * Used by ContextBar and ChatPanel for context usage percentage display.
 */

/** Known model context windows (tokens). Keys are model ID prefixes. */
const MODEL_CONTEXT_WINDOWS: Record<string, number> = {
  // Anthropic official models
  'claude-opus-4': 200_000,
  'claude-sonnet-4': 200_000,
  'claude-haiku-4': 200_000,
  'claude-3-5-sonnet': 200_000,
  'claude-3-5-haiku': 200_000,
  'claude-3-opus': 200_000,
  // 1M context models (some providers offer extended context)
  'claude-opus-4-8[1m]': 1_000_000,
  'claude-sonnet-4-6[1m]': 1_000_000,
  // Third-party proxy models (adjust as needed)
  'mimo-v2.5-pro': 1_000_000,
};

/**
 * Get the context window size for a model.
 * Tries exact match first, then prefix match, then falls back to 200K.
 */
export function getContextWindowMax(model?: string | null): number {
  if (!model) return 200_000;
  const lower = model.toLowerCase();

  // Exact match
  if (MODEL_CONTEXT_WINDOWS[lower] !== undefined) {
    return MODEL_CONTEXT_WINDOWS[lower];
  }

  // Prefix match (longest prefix wins)
  let bestMatch = '';
  let bestValue = 200_000;
  for (const [key, value] of Object.entries(MODEL_CONTEXT_WINDOWS)) {
    if (lower.startsWith(key) && key.length > bestMatch.length) {
      bestMatch = key;
      bestValue = value;
    }
  }

  return bestValue;
}

/** Check if a model supports 1M context window */
export function isOneMillionModel(model?: string | null): boolean {
  return getContextWindowMax(model) >= 1_000_000;
}

/** Format token count for display (e.g., 120000 → "120K", 1500000 → "1.5M") */
export function formatTokenCount(count: number): string {
  if (count >= 1_000_000) {
    return `${(count / 1_000_000).toFixed(1)}M`;
  }
  if (count >= 1_000) {
    return `${(count / 1_000).toFixed(1)}K`;
  }
  return String(count);
}
