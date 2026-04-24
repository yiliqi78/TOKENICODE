#!/usr/bin/env node

// tokenicode-cli.mjs — CLI tool for driving TOKENICODE GUI (debug builds)
// Connects to the test harness Unix socket provided by tauri-plugin-mcp.
// All output is JSON (one line per invocation) for AI consumption.
// Zero external dependencies — Node.js built-in modules only.

import { connect } from 'node:net';
import { randomUUID } from 'node:crypto';
import { execFileSync, execSync, spawn } from 'node:child_process';
import { existsSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

// ─── Constants ───────────────────────────────────────────────────────────────

const SOCKET_PATH = process.env.TOKENICODE_SOCKET || '/tmp/tokenicode-test.sock';
const DEFAULT_TIMEOUT = 10_000;
const SCREENSHOT_TIMEOUT = 15_000;
const RESTART_TIMEOUT = 120_000;
const POLL_INTERVAL = 500;

// ─── Socket Client ───────────────────────────────────────────────────────────

function createClient(socketPath) {
  let socket = null;
  let buffer = '';
  let closed = false;
  const pending = new Map(); // id → { resolve, reject, timer }

  function rejectAll(reason) {
    closed = true;
    for (const [id, p] of pending) {
      clearTimeout(p.timer);
      p.reject(new Error(reason));
    }
    pending.clear();
  }

  function onData(chunk) {
    buffer += chunk.toString();
    let idx;
    while ((idx = buffer.indexOf('\n')) !== -1) {
      const line = buffer.slice(0, idx);
      buffer = buffer.slice(idx + 1);
      if (!line) continue;
      try {
        const msg = JSON.parse(line);
        const p = pending.get(msg.id);
        if (p) {
          clearTimeout(p.timer);
          pending.delete(msg.id);
          p.resolve(msg);
        }
      } catch {
        // Protocol error: log to stderr but keep processing
        process.stderr.write(`[tokenicode-cli] malformed socket response: ${line.slice(0, 120)}\n`);
      }
    }
  }

  return {
    connect() {
      return new Promise((resolve, reject) => {
        socket = connect({ path: socketPath }, () => {
          // After successful connect, set up disconnect handlers
          socket.on('close', () => rejectAll('Socket closed by TOKENICODE'));
          socket.on('end', () => rejectAll('Socket connection ended'));
          resolve();
        });
        socket.on('error', (err) => {
          if (!closed) rejectAll(`Socket error: ${err.message}`);
          reject(err);
        });
        socket.on('data', onData);
      });
    },

    send(command, payload = {}, timeout = DEFAULT_TIMEOUT) {
      if (closed) return Promise.reject(new Error('Socket already closed'));
      return new Promise((resolve, reject) => {
        const id = randomUUID();
        const timer = setTimeout(() => {
          pending.delete(id);
          reject(new Error(`Command '${command}' timed out after ${timeout}ms`));
        }, timeout);
        pending.set(id, { resolve, reject, timer });
        socket.write(JSON.stringify({ command, payload, id }) + '\n');
      });
    },

    close() {
      if (socket) {
        closed = true;
        for (const [, p] of pending) clearTimeout(p.timer);
        pending.clear();
        socket.destroy();
      }
    },
  };
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Run arbitrary JS in the TOKENICODE webview. Returns the raw result string. */
async function execJs(client, code, timeout = DEFAULT_TIMEOUT) {
  const resp = await client.send('execute_js', { code, window_label: 'main' }, timeout);
  if (!resp.success) throw new Error(resp.error || 'execute_js failed');
  if (resp.data?.type === 'error') throw new Error(resp.data.error || 'JS error in webview');
  return resp.data?.result;
}

/** Call a window.__tokenicode_test method. Returns parsed JSON result. */
async function callHelper(client, method, argsStr = '') {
  const code = `JSON.stringify(window.__tokenicode_test.${method}(${argsStr}))`;
  const raw = await execJs(client, code);
  if (raw == null || raw === 'undefined' || raw === '') return null;
  return JSON.parse(raw);
}

function parseArgs(argv) {
  const flags = {};
  const positional = [];
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith('--')) {
      const key = argv[i].slice(2);
      // Boolean flags (no value)
      if (i + 1 >= argv.length || argv[i + 1].startsWith('--')) {
        flags[key] = true;
        continue;
      }
      flags[key] = argv[++i];
    } else {
      positional.push(argv[i]);
    }
  }
  return { flags, positional };
}

function out(obj) {
  process.stdout.write(JSON.stringify(obj) + '\n');
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

// ─── Command Handlers ────────────────────────────────────────────────────────
// Each returns a plain object. Merged with { ok: true } on success.

const commands = {

  // ── Health ──

  async ping(client) {
    const resp = await client.send('ping', { value: 'test' });
    if (!resp.success) throw new Error('Ping failed');
    return { pong: true };
  },

  async status(client) {
    return await callHelper(client, 'status');
  },

  // ── Chat: Input & Send ──

  async type(client, { positional }) {
    const text = positional.join(' ');
    if (!text) throw new Error('Usage: type TEXT');
    return await callHelper(client, 'type', JSON.stringify(text));
  },

  async send(client) {
    return await callHelper(client, 'send');
  },

  async stop(client) {
    return await callHelper(client, 'stop');
  },

  async 'delete-session'(client) {
    return await callHelper(client, 'deleteCurrentSession');
  },

  // ── Chat: Read ──

  async 'get-messages'(client, { flags }) {
    const rawLast = flags.all ? undefined : parseInt(flags.last);
    const last = rawLast != null ? Math.max(1, rawLast) : (flags.all ? undefined : 10);
    const tabId = flags.tab;
    const opts = {};
    if (last != null) opts.last = last;
    if (tabId) opts.tabId = tabId;
    opts.summary = !flags.full;
    return await callHelper(client, 'getMessages', JSON.stringify(opts));
  },

  async 'get-active-session'(client) {
    const id = await callHelper(client, 'getActiveSessionId');
    return { session: id };
  },

  async 'get-all-sessions'(client) {
    const sessions = await callHelper(client, 'getAllSessions');
    return { sessions, count: Array.isArray(sessions) ? sessions.length : 0 };
  },

  async 'get-current-model'(client) {
    const model = await callHelper(client, 'getCurrentModel');
    return { model };
  },

  async 'get-current-provider'(client) {
    const provider = await callHelper(client, 'getCurrentProvider');
    return { provider };
  },

  async 'is-streaming'(client, { flags }) {
    const tabId = flags.tab;
    const streaming = await callHelper(client, 'isStreaming', tabId ? JSON.stringify(tabId) : '');
    return { streaming };
  },

  // ── Session Management ──

  async 'switch-session'(client, { positional }) {
    const id = positional[0];
    if (!id) throw new Error('Usage: switch-session SESSION_ID');
    // loadSession is async — execute_js doesn't await Promises.
    // Use per-request ID to avoid race conditions between concurrent calls.
    const reqId = randomUUID().slice(0, 8);
    const startCode = `(function(){
      if(!window.__tkn_loads) window.__tkn_loads = {};
      window.__tkn_loads[${JSON.stringify(reqId)}] = {done:false, result:null};
      window.__tokenicode_test.loadSession(${JSON.stringify(id)})
        .then(function(r){ window.__tkn_loads[${JSON.stringify(reqId)}] = {done:true, result:r}; })
        .catch(function(e){ window.__tkn_loads[${JSON.stringify(reqId)}] = {done:true, result:{error:e.message}}; });
      return 'started';
    })()`;
    await execJs(client, startCode);

    // Poll for completion (up to 30s)
    const deadline = Date.now() + 30_000;
    while (Date.now() < deadline) {
      await sleep(300);
      const doneRaw = await execJs(client, `JSON.stringify(window.__tkn_loads && window.__tkn_loads[${JSON.stringify(reqId)}])`);
      if (doneRaw) {
        const slot = JSON.parse(doneRaw);
        if (slot && slot.done) {
          // Clean up
          await execJs(client, `delete window.__tkn_loads[${JSON.stringify(reqId)}]`).catch(() => {});
          return slot.result || { switchedTo: id };
        }
      }
    }
    // Timeout — clean up and report failure
    await execJs(client, `delete window.__tkn_loads[${JSON.stringify(reqId)}]`).catch(() => {});
    throw new Error(`Session load timed out after 30s for ${id}`);
  },

  async 'new-session'(client, { flags }) {
    const cwd = flags.cwd;
    if (cwd) {
      return await callHelper(client, 'newSession', JSON.stringify(cwd));
    }
    return await callHelper(client, 'newSession');
  },

  async 'check-editor'(client) {
    const deadline = Date.now() + 3000;
    let last = null;
    while (Date.now() < deadline) {
      const code = `JSON.stringify({
        hasEditor: !!window.__tokenicode_editor || !!document.querySelector('[data-testid=send-button], [data-chat-input], .tiptap[contenteditable=true]'),
        editorReady: !!window.__tokenicode_editor,
        hasChatPanel: !!document.querySelector('[data-testid=chat-messages], .selectable'),
        session: window.__tokenicode_test.status().session
      })`;
      try {
        const raw = await execJs(client, code, 3000);
        last = raw ? JSON.parse(raw) : { hasEditor: false, hasChatPanel: false, session: null };
        if (last.hasEditor && last.editorReady) return last;
        if (!last.session) return last;
      } catch {
        last = { hasEditor: false, hasChatPanel: false, session: null };
      }
      await sleep(100);
    }
    return last || { hasEditor: false, hasChatPanel: false, session: null };
  },

  // ── Model & Provider ──

  async 'switch-model'(client, { positional }) {
    const id = positional[0];
    if (!id) throw new Error('Usage: switch-model MODEL_ID');
    return await callHelper(client, 'switchModel', JSON.stringify(id));
  },

  async 'switch-provider'(client, { positional }) {
    const raw = positional[0];
    if (raw === undefined) throw new Error('Usage: switch-provider PROVIDER_ID  (or "null" to reset)');
    const id = raw === 'null' ? null : raw;
    return await callHelper(client, 'switchProvider', JSON.stringify(id));
  },

  // ── Settings ──

  async 'open-settings'(client) {
    return await callHelper(client, 'openSettings');
  },

  async 'close-settings'(client) {
    return await callHelper(client, 'closeSettings');
  },

  async 'switch-settings-tab'(client, { positional }) {
    const id = positional[0];
    if (!id) throw new Error('Usage: switch-settings-tab TAB_ID  (general|provider|cli|mcp)');
    return await callHelper(client, 'switchSettingsTab', JSON.stringify(id));
  },

  // ── Permission ──

  async 'allow-permission'(client) {
    return await callHelper(client, 'allowPermission');
  },

  async 'deny-permission'(client) {
    return await callHelper(client, 'denyPermission');
  },

  // ── Visual & Text ──

  async screenshot(client) {
    const resp = await client.send('take_screenshot', {
      window_label: 'main',
      save_to_disk: true,
      thumbnail: false,
    }, SCREENSHOT_TIMEOUT);
    if (!resp.success) throw new Error(resp.error || 'Screenshot failed');
    const path = resp.data?.filePath || resp.data?.file_path;
    if (!path) throw new Error('Screenshot saved but no file path returned');
    return { path };
  },

  async 'get-visible-text'(client, { flags }) {
    // Returns the visible text on the page — what a human would see, no HTML/rendering noise.
    // Optionally target a specific area via CSS selector.
    const selector = flags.selector || 'body';
    const code = `(function(){
      var el = document.querySelector(${JSON.stringify(selector)});
      if (!el) return JSON.stringify({error: 'Element not found: ${selector}'});
      var text = el.innerText;
      return JSON.stringify({text: text, length: text.length});
    })()`;
    const raw = await execJs(client, code);
    if (!raw) return { text: '', length: 0 };
    return JSON.parse(raw);
  },

  async 'query-page'(client, { flags }) {
    const mode = flags.mode || 'state';
    const modeMap = {
      map: 'get_page_map',
      state: 'get_page_state',
      info: 'get_app_info',
    };
    const command = modeMap[mode];
    if (!command) throw new Error(`Invalid mode: ${mode}. Use map|state|info`);

    const payload = { window_label: 'main' };
    if (mode === 'map') {
      payload.include_content = !flags['no-content'];
      payload.interactive_only = !!flags['interactive-only'];
      payload.include_metadata = true;
    }
    const resp = await client.send(command, payload);
    if (!resp.success) throw new Error(resp.error || `${command} failed`);
    return resp.data;
  },

  async 'get-dom'(client) {
    const resp = await client.send('get_dom', { window_label: 'main' });
    if (!resp.success) throw new Error(resp.error || 'get_dom failed');
    return { html: resp.data };
  },

  // ── Waiting ──

  async 'wait-for'(client, { positional, flags }) {
    const timeout = parseInt(flags.timeout) || 10_000;
    const text = flags.text || (positional.length > 0 ? positional.join(' ') : null);
    const selector = flags.selector || null;
    if (!text && !selector) {
      throw new Error('Usage: wait-for --text TEXT | --selector SELECTOR | TEXT');
    }

    const deadline = Date.now() + timeout;
    let lastError = null;
    while (Date.now() < deadline) {
      const remaining = Math.max(500, deadline - Date.now());
      const code = `(function(){
        const selector = ${JSON.stringify(selector)};
        const text = ${JSON.stringify(text)};
        if (selector) {
          const el = document.querySelector(selector);
          if (el) return JSON.stringify({ found: true, selector, text: el.innerText || el.textContent || '' });
        }
        if (text) {
          const bodyText = document.body ? (document.body.innerText || document.body.textContent || '') : '';
          if (bodyText.includes(text)) return JSON.stringify({ found: true, text });
        }
        return JSON.stringify({ found: false });
      })()`;
      try {
        const raw = await execJs(client, code, Math.min(3000, remaining + 250));
        const result = raw ? JSON.parse(raw) : { found: false };
        if (result.found) return result;
      } catch (err) {
        lastError = err.message;
      }
      await sleep(Math.min(POLL_INTERVAL, Math.max(50, deadline - Date.now())));
    }
    const target = selector ? `selector ${selector}` : `text ${text}`;
    throw new Error(`wait-for timed out after ${timeout}ms for ${target}${lastError ? ` (${lastError})` : ''}`);
  },

  async 'wait-until-done'(client, { flags }) {
    const timeout = parseInt(flags.timeout) || 60_000;
    const start = Date.now();

    // Brief delay to let CLI process start
    await sleep(300);

    while (Date.now() - start < timeout) {
      const status = await callHelper(client, 'status');

      if (status.pendingPermission) {
        return { status: 'permission_pending', elapsed: Date.now() - start, ...status };
      }
      if (!status.active) {
        return { status: 'completed', elapsed: Date.now() - start, ...status };
      }

      await sleep(POLL_INTERVAL);
    }

    const finalStatus = await callHelper(client, 'status');
    return {
      status: 'timeout',
      error: `Timed out after ${timeout}ms (phase: ${finalStatus.phase}, msgs: ${finalStatus.messageCount})`,
      elapsed: Date.now() - start,
      ...finalStatus,
    };
  },

  async 'wait-for-phase'(client, { positional, flags }) {
    const target = positional[0];
    if (!target) throw new Error('Usage: wait-for-phase PHASE [--timeout MS]  (phases: thinking|writing|tool|awaiting|completed)');
    const timeout = parseInt(flags.timeout) || 30_000;
    const start = Date.now();
    await sleep(300);
    while (Date.now() - start < timeout) {
      const status = await callHelper(client, 'status');
      if (status.phase === target) {
        return { phase: target, elapsed: Date.now() - start, ...status };
      }
      if (!status.active && status.phase !== target) {
        return { error: `Session ended (phase: ${status.phase}) before reaching '${target}'`, elapsed: Date.now() - start, ...status };
      }
      await sleep(POLL_INTERVAL);
    }
    const finalStatus = await callHelper(client, 'status');
    return { error: `Timed out waiting for phase '${target}' after ${timeout}ms`, elapsed: Date.now() - start, ...finalStatus };
  },

  async delay(_client, { positional }) {
    const ms = parseInt(positional[0]) || 1000;
    if (ms > 300_000) throw new Error('delay max 300s');
    await sleep(ms);
    return { delayed: ms };
  },

  // ── Raw JS ──

  async exec(client, { positional, flags }) {
    const code = positional.join(' ');
    if (!code) throw new Error('Usage: exec JS_CODE');
    const timeout = parseInt(flags.timeout) || DEFAULT_TIMEOUT;
    // Auto-wrap in stringify to handle object return values that otherwise serialize to undefined
    const wrapped = `(function(){try{var __r=(${code});return typeof __r==='object'&&__r!==null?JSON.stringify(__r):String(__r)}catch(e){return JSON.stringify({__error:e.message})}})()`;
    const raw = await execJs(client, wrapped, timeout);
    try {
      return { result: JSON.parse(raw) };
    } catch {
      return { result: raw };
    }
  },

  // ── Restart ──

  async restart(client, { flags }) {
    // Soft restart: reload webview in the same window (no new window).
    // Resets frontend state while keeping the Tauri process alive.
    const timeout = parseInt(flags.timeout) || 30_000;
    const start = Date.now();

    // Trigger reload
    await execJs(client, 'location.reload()').catch(() => {});
    await sleep(2000);

    // Poll until webview is ready (test harness re-initialized after reload)
    while (Date.now() - start < timeout) {
      try {
        const r = await execJs(client, '"ready"', 3000);
        if (r === 'ready') {
          return { restarted: true, mode: 'reload', elapsed: Date.now() - start };
        }
      } catch { /* webview not ready yet */ }
      await sleep(1000);
    }
    throw new Error(`Webview reload timed out after ${Date.now() - start}ms`);
  },

  async relaunch(_client, { flags }) {
    // Hard restart: kill Tauri process tree + Vite, relaunch `pnpm tauri dev` (opens new window).
    // This is a standalone command — it manages its own socket connections.
    const timeout = parseInt(flags.timeout) || RESTART_TIMEOUT;
    const start = Date.now();

    // Step 1: Find the process that owns the socket (uses SOCKET_PATH, not hardcoded name)
    let pid = null;
    try {
      // lsof -t returns only PIDs. Use -- to prevent SOCKET_PATH being treated as a flag.
      const lsofOut = execFileSync('lsof', ['-t', '-U', '--', SOCKET_PATH], {
        encoding: 'utf8',
        timeout: 5000,
      });
      const pids = lsofOut.trim().split('\n').map(Number).filter(Boolean);
      // Take the first PID (the server process)
      if (pids.length > 0) pid = pids[0];
    } catch { /* socket not found or lsof failed — app may already be dead */ }

    // Step 2: Kill the process group
    if (pid) {
      // Resolve the actual process group ID (PGID may differ from PID)
      let pgid = pid;
      try {
        const pgidOut = execFileSync('ps', ['-o', 'pgid=', '-p', String(pid)], {
          encoding: 'utf8',
          timeout: 3000,
        });
        const parsed = parseInt(pgidOut.trim());
        if (parsed > 0) pgid = parsed;
      } catch { /* fallback to using pid as pgid */ }

      try {
        process.kill(-pgid, 'SIGTERM');
      } catch {
        try { process.kill(pid, 'SIGKILL'); } catch { /* already dead */ }
      }
      // Wait for process to die (up to 10s), escalate to SIGKILL if needed
      const killDeadline = Date.now() + 10_000;
      let alive = true;
      while (Date.now() < killDeadline) {
        try { process.kill(pid, 0); } catch { alive = false; break; }
        await sleep(300);
      }
      if (alive) {
        // Escalate to SIGKILL
        try { process.kill(-pgid, 'SIGKILL'); } catch {}
        try { process.kill(pid, 'SIGKILL'); } catch {}
        await sleep(500);
      }
    }

    // Step 2.5a: Kill any orphaned target/debug/tokenicode processes that survived PGID kill.
    // After hours of unattended testing with repeated relaunches, child processes can accumulate
    // as zombies (~1.5 GB after 76 processes). pkill returns non-zero if no matches, so wrap in try/catch.
    try {
      execSync('pkill -9 -f "target/debug/tokenicode"', { timeout: 5000, stdio: 'ignore' });
      await sleep(500);
    } catch { /* no matching processes — expected on clean shutdown */ }

    // Step 2.5b: Kill Vite dev server on port 1420 (may survive PGID kill)
    try {
      const viteOut = execFileSync('lsof', ['-t', '-i', ':1420'], { encoding: 'utf8', timeout: 3000 });
      for (const vpid of viteOut.trim().split('\n').map(Number).filter(Boolean)) {
        try { process.kill(vpid, 'SIGTERM'); } catch { /* already dead */ }
      }
      await sleep(1000);
    } catch { /* no Vite server running */ }

    // Step 3: Clean up stale socket (always, regardless of whether pid was found)
    if (existsSync(SOCKET_PATH)) {
      try { rmSync(SOCKET_PATH, { force: true }); } catch { /* best effort */ }
    }

    // Step 4: Relaunch pnpm tauri dev
    const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
    const env = { ...process.env, PATH: `${process.env.HOME}/.cargo/bin:${process.env.PATH}` };

    // Wait for spawn confirmation — detect both ENOENT (error event) and early crash (exit event)
    const child = await new Promise((resolveSpawn, rejectSpawn) => {
      const proc = spawn('pnpm', ['tauri', 'dev'], {
        cwd: projectRoot,
        detached: true,
        stdio: 'ignore',
        env,
      });
      let settled = false;
      const settle = () => {
        if (settled) return;
        settled = true;
        proc.removeAllListeners('error');
        proc.removeAllListeners('exit');
        resolveSpawn(proc);
      };
      const earlyTimer = setTimeout(settle, 2000);
      proc.on('error', (err) => {
        if (settled) return;
        settled = true;
        clearTimeout(earlyTimer);
        rejectSpawn(new Error(`Failed to start pnpm tauri dev: ${err.message}`));
      });
      proc.on('exit', (code, signal) => {
        if (settled) return;
        settled = true;
        clearTimeout(earlyTimer);
        rejectSpawn(new Error(`pnpm tauri dev exited immediately: code=${code} signal=${signal}`));
      });
    });
    child.unref();

    // Step 5: Poll ping until the app is ready
    const pollDeadline = start + timeout;
    while (Date.now() < pollDeadline) {
      await sleep(2000);
      try {
        const testClient = createClient(SOCKET_PATH);
        await testClient.connect();
        const resp = await testClient.send('ping', { value: 'restart' }, 5000);
        testClient.close();
        if (resp.success) {
          return { restarted: true, elapsed: Date.now() - start, pid: child.pid };
        }
      } catch {
        // Not ready yet — keep polling
      }
    }

    throw new Error(`Restart timed out after ${Date.now() - start}ms — app did not become ready`);
  },

  // ── Help (JSON) ──

  async help() {
    return {
      usage: 'node scripts/tokenicode-cli.mjs <command> [args] [--flags]',
      commands: {
        health: ['ping', 'status', 'restart [--timeout MS]', 'relaunch [--timeout MS]'],
        chat: ['type TEXT', 'send', 'stop', 'delete-session', 'get-messages [--last N] [--all] [--tab ID] [--full]', 'check-editor'],
        session: ['get-active-session', 'get-all-sessions', 'switch-session ID', 'new-session [--cwd PATH]'],
        model: ['get-current-model', 'get-current-provider', 'switch-model ID', 'switch-provider ID'],
        settings: ['open-settings', 'close-settings', 'switch-settings-tab ID'],
        permission: ['allow-permission', 'deny-permission'],
        visual: ['screenshot', 'get-visible-text [--selector CSS]', 'query-page [--mode map|state|info]', 'get-dom'],
        waiting: ['wait-for --text TEXT|--selector SEL [--timeout MS]', 'wait-until-done [--timeout MS]', 'wait-for-phase PHASE [--timeout MS]', 'delay MS'],
        raw: ['exec JS_CODE [--timeout MS]'],
      },
      env: { TOKENICODE_SOCKET: `Override socket path (default: ${SOCKET_PATH})` },
    };
  },
};

// ─── Main ────────────────────────────────────────────────────────────────────

async function main() {
  const argv = process.argv.slice(2);

  // Commands that don't need a pre-connected socket
  const noSocketCommands = new Set(['help', 'relaunch', 'delay']);

  if (argv.length === 0 || argv[0] === 'help' || argv[0] === '--help' || argv[0] === '-h') {
    const result = await commands.help();
    out({ ok: true, ...result });
    return;
  }

  const cmd = argv[0];
  const handler = commands[cmd];
  if (!handler) {
    out({ ok: false, error: `Unknown command: '${cmd}'. Run with 'help' for available commands.` });
    process.exit(1);
  }

  const parsed = parseArgs(argv.slice(1));

  // relaunch manages its own socket connections
  if (noSocketCommands.has(cmd)) {
    try {
      const result = await handler(null, parsed);
      out({ ok: true, ...result });
    } catch (err) {
      out({ ok: false, error: err.message });
      process.exit(1);
    }
    return;
  }

  let client;
  try {
    client = createClient(SOCKET_PATH);
    await client.connect();
  } catch (err) {
    const msg =
      err.code === 'ENOENT'
        ? `TOKENICODE not running (socket not found at ${SOCKET_PATH}). Start with: pnpm tauri dev`
        : err.code === 'ECONNREFUSED'
          ? `Socket exists but connection refused. Is TOKENICODE debug build running?`
          : `Cannot connect to TOKENICODE: ${err.message}`;
    out({ ok: false, error: msg });
    process.exit(1);
  }

  try {
    const result = await handler(client, parsed);
    // If handler returned an object with 'error' key (from test helper), preserve full context
    if (result && result.error && !result.ok) {
      out({ ok: false, ...result });
      process.exit(1);
    }
    out({ ok: true, ...result });
  } catch (err) {
    out({ ok: false, error: err.message });
    process.exit(1);
  } finally {
    client.close();
  }
}

main();
