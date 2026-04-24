const preservedThinkingByKey = new Map<string, string>();

function thinkingKey(tabId: string, stdinId?: string) {
  return stdinId ? `stdin:${stdinId}` : `tab:${tabId}`;
}

export function rememberPreservedThinkingSnapshot(
  tabId: string,
  stdinId: string | undefined,
  content: string,
): void {
  if (!content) return;
  preservedThinkingByKey.set(thinkingKey(tabId, stdinId), content);
}

export function clearPreservedThinkingSnapshot(tabId: string, stdinId?: string): void {
  preservedThinkingByKey.delete(thinkingKey(tabId, stdinId));
  if (stdinId) preservedThinkingByKey.delete(thinkingKey(tabId, undefined));
}

export function filterThinkingDeltaAfterPreservedSnapshot(params: {
  tabId: string;
  stdinId?: string;
  currentThinking: string;
  delta: string;
}): string {
  const { tabId, stdinId, currentThinking, delta } = params;
  if (!delta) return '';

  const key = thinkingKey(tabId, stdinId);
  const preserved = preservedThinkingByKey.get(key);
  if (!preserved) return delta;

  const looksLikeDuplicateTail =
    delta.trim().length >= 4
    && currentThinking === preserved
    && preserved.endsWith(delta);

  if (looksLikeDuplicateTail) return '';
  preservedThinkingByKey.delete(key);
  return delta;
}
