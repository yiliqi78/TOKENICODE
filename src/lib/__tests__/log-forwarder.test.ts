import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn(() => Promise.resolve()) }));

import {
  formatConsoleArgs,
  installConsoleForwarder,
  levelFor,
  redactSecrets,
  MAX_MESSAGE_CHARS,
  type LogSink,
} from '../log-forwarder';

describe('redactSecrets', () => {
  it('masks sk- keys and bearer tokens', () => {
    const r = redactSecrets('key sk-ant-api03-AbCdEfGhIjKlMnOp Authorization: Bearer abcdefghijklmnop');
    expect(r).not.toContain('AbCdEfGh');
    expect(r).not.toContain('abcdefghijklmnop');
    expect(r).toContain('sk-***');
    expect(r).toContain('Bearer ***');
  });

  it('masks env-style pairs but keeps token counts and product name', () => {
    const r = redactSecrets(
      'ANTHROPIC_API_KEY=abcd1234efgh x-api-key: zzzz9999 "auth_token": "tok_12345678" input_tokens: 1234 tokenicode=ok',
    );
    expect(r).not.toContain('abcd1234efgh');
    expect(r).not.toContain('zzzz9999');
    expect(r).not.toContain('tok_12345678');
    expect(r).toContain('input_tokens: 1234');
    expect(r).toContain('tokenicode=ok');
  });

  it('masks url userinfo, query secrets and jwts', () => {
    const jwt = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c';
    const r = redactSecrets(`http://alice:s3cret@127.0.0.1:7890 https://x.com/v1?key=abcdef&model=opus ${jwt}`);
    expect(r).toContain('http://alice:***@127.0.0.1:7890');
    expect(r).toContain('?key=***&model=opus');
    expect(r).not.toContain('SflKxwRJ');
  });

  it('leaves plain lines alone', () => {
    const s = '[TOKENICODE] session started pid=123 cwd=/Users/me/proj';
    expect(redactSecrets(s)).toBe(s);
  });
});

describe('formatConsoleArgs', () => {
  it('joins strings, stringifies objects and errors', () => {
    const err = new Error('boom');
    const out = formatConsoleArgs(['[TOKENICODE] x', { a: 1 }, 42, undefined, err]);
    expect(out).toContain('[TOKENICODE] x {"a":1} 42 undefined');
    expect(out).toContain('Error: boom');
  });

  it('truncates very long messages', () => {
    const out = formatConsoleArgs(['x'.repeat(MAX_MESSAGE_CHARS + 500)]);
    expect(out.length).toBeLessThan(MAX_MESSAGE_CHARS + 50);
    expect(out).toContain('+500 chars');
  });

  it('survives circular objects', () => {
    const o: Record<string, unknown> = {};
    o.self = o;
    expect(() => formatConsoleArgs([o])).not.toThrow();
  });
});

describe('levelFor', () => {
  it('always forwards warn and error', () => {
    expect(levelFor('warn', 'anything')).toBe('warn');
    expect(levelFor('error', 'anything')).toBe('error');
  });
  it('forwards prefixed log/info/debug only', () => {
    expect(levelFor('log', '[TOKENICODE] hi')).toBe('info');
    expect(levelFor('debug', '[TOKENICODE:stream] hi')).toBe('debug');
    expect(levelFor('log', '[ErrorBoundary] Uncaught')).toBe('info');
    expect(levelFor('log', 'random noise')).toBeNull();
    expect(levelFor('info', 'random noise')).toBeNull();
  });
});

describe('installConsoleForwarder', () => {
  let sink: LogSink & { calls: Array<[string, string, string]> };
  let uninstall: () => void;
  const spies: Array<ReturnType<typeof vi.spyOn>> = [];

  beforeEach(() => {
    const calls: Array<[string, string, string]> = [];
    const mk = (level: string) => (message: string, origin: string) => {
      calls.push([level, message, origin]);
      return Promise.resolve();
    };
    sink = { calls, debug: mk('debug'), info: mk('info'), warn: mk('warn'), error: mk('error') };
    for (const m of ['log', 'info', 'debug', 'warn', 'error'] as const) {
      spies.push(vi.spyOn(console, m).mockImplementation(() => {}));
    }
    uninstall = installConsoleForwarder(sink);
  });

  afterEach(() => {
    uninstall();
    for (const s of spies) s.mockRestore();
    spies.length = 0;
  });

  it('forwards warn/error and prefixed logs, redacted', () => {
    console.warn('careful', { n: 1 });
    console.error(new Error('bad'));
    console.log('[TOKENICODE] spawn ANTHROPIC_API_KEY=secretvalue123');
    console.log('unrelated chatter');
    expect(sink.calls.map(([l]) => l)).toEqual(['warn', 'error', 'info']);
    expect(sink.calls[0][1]).toBe('careful {"n":1}');
    expect(sink.calls[0][2]).toBe('console.warn');
    expect(sink.calls[1][1]).toContain('Error: bad');
    expect(sink.calls[1][2]).toBe('console.error');
    expect(sink.calls[2][1]).toContain('ANTHROPIC_API_KEY=***');
    expect(sink.calls[2][1]).not.toContain('secretvalue123');
  });

  it('still calls the original console method', () => {
    console.warn('x');
    expect(spies[3]).toHaveBeenCalledWith('x');
  });

  it('stops forwarding after uninstall', () => {
    uninstall();
    console.error('after');
    expect(sink.calls).toEqual([]);
    uninstall = () => {};
  });
});
