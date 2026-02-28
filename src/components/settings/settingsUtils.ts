/** Detect if an error message looks like a permission/access issue */
export function isPermissionError(msg: string): boolean {
  const hints = ['EPERM', 'EACCES', 'permission denied', 'access denied',
    'Access is denied', 'operation not permitted'];
  const lower = msg.toLowerCase();
  return hints.some(h => lower.includes(h.toLowerCase()));
}

/** Detect if an error message looks like a network/firewall issue */
export function isNetworkError(msg: string): boolean {
  // If it's a permission error, don't misclassify as network
  // (e.g. FetchError wrapping EPERM on npm cache)
  if (isPermissionError(msg)) return false;
  const hints = ['timeout', 'timed out', 'network', 'connect', 'ENOTFOUND',
    'ECONNREFUSED', 'ECONNRESET', 'ETIMEDOUT', 'fetch', 'Failed to download',
    'All install methods failed', 'dns', 'certificate'];
  const lower = msg.toLowerCase();
  return hints.some(h => lower.includes(h.toLowerCase()));
}
