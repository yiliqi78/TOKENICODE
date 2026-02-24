/** Strip ANSI escape sequences from a string (terminal color/cursor codes). */
export function stripAnsi(str: string): string {
  return str.replace(
    // eslint-disable-next-line no-control-regex
    /\x1b\[[0-9;]*[A-Za-z]|\x1b\].*?\x07|\x1b\[[\?]?[0-9;]*[a-zA-Z]/g,
    '',
  );
}
