import { invoke } from '@tauri-apps/api/core';
import { listen, UnlistenFn } from '@tauri-apps/api/event';

// --- Types ---

export interface StartSessionParams {
  prompt: string;
  cwd: string;
  model?: string;
  /** Desk-generated process key (stdinId) — used as key in Rust StdinManager/ProcessManager.
   *  NOT the Claude CLI session UUID (that comes back as SessionInfo.cli_session_id). */
  session_id?: string;
  allowed_tools?: string[];
  /** Resume an existing Claude CLI conversation by its UUID (for session continuity) */
  resume_session_id?: string;
  /** Thinking effort level: 'off' | 'low' | 'medium' | 'high' | 'max' */
  thinking_level?: string;
  /** Session mode: "ask", "plan", or undefined for auto */
  session_mode?: string;
  /** Active provider ID from providers.json */
  provider_id?: string;
  /** Permission mode for CLI control protocol.
   *  "acceptEdits" | "default" | "plan" | "bypassPermissions"
   *  When not "bypassPermissions", enables structured permission requests via SDK protocol. */
  permission_mode?: string;
  /** When true and resume_session_id is set, strip thinking blocks from the session JSONL
   *  before resuming. This prevents "invalid thinking signature" 400 errors when switching
   *  to a different model that can't verify the old model's cryptographic signatures. */
  model_switch?: boolean;
}

export interface SessionInfo {
  /** Desk-generated process key used as routing/stdin identifier.
   *  Maps to Rust StdinManager keys. NOT the Claude CLI session UUID. */
  stdin_id: string;
  /** Claude CLI's session UUID for --resume. Non-null only when resuming;
   *  null for new sessions — the real UUID arrives via the first system:init
   *  stream event and is stored in sessionStore.cliResumeId. */
  cli_session_id: string | null;
  pid: number;
  cli_path: string;
}

export interface SessionListItem {
  id: string;
  path: string;
  project: string;
  projectDir: string;
  modifiedAt: number;
  preview: string;
  /** CLI's own session UUID, used for --resume. Null for new sessions before CLI responds. */
  cliResumeId: string | null;
}

export interface ContentSearchResult {
  session_id: string;
  snippet: string;
  match_count: number;
  match_role: 'user' | 'assistant';
}

export interface FileNode {
  name: string;
  path: string;
  is_dir: boolean;
  children: FileNode[] | null;
}

export interface RecentProject {
  name: string;
  path: string;
  shortPath: string;
  lastUsed: number;
}

export interface FileChangeEvent {
  kind: 'created' | 'modified' | 'removed';
  paths: string[];
  root: string;
}

export interface SlashCommand {
  name: string;
  description: string;
  source: 'builtin' | 'global' | 'project';
  has_args: boolean;
}

export interface SkillInfo {
  name: string;
  description: string;
  path: string;
  scope: 'global' | 'project';
  disable_model_invocation?: boolean;
  user_invocable?: boolean;
  allowed_tools?: string[];
  argument_hint?: string;
  model?: string;
  context?: string;
  agent?: string;
  version?: string;
}

export interface CliStatus {
  installed: boolean;
  path: string | null;
  version: string | null;
  // NEW-D: removed `version_compatible` — the Rust CliStatus struct never
  // serialized this field, so the frontend always received `undefined`.
  git_bash_missing: boolean;
}

export interface CliCandidate {
  path: string;
  source: 'official' | 'system' | 'appLocal' | 'versionManager' | 'dynamic';
  isNative: boolean;
  version: string | null;
  issues: string[];
}

export interface CleanupResult {
  removed: string[];
  skipped: { path: string; reason: string }[];
}

export interface AuthStatus {
  authenticated: boolean;
  unknown?: boolean;
}

export interface StepResult {
  ok: boolean;
  message: string;
}

export interface ConnectionTestResult {
  connectivity: StepResult;
  auth: StepResult;
  model: StepResult;
}

export interface SetupOutputEvent {
  stream: 'stdout' | 'stderr';
  line: string;
}

export interface SetupExitEvent {
  code: number;
}

export interface DownloadProgressEvent {
  downloaded: number;
  total: number;
  percent: number;
  phase: 'version' | 'downloading' | 'installing' | 'complete'
       | 'native_version' | 'native_manifest' | 'native_download' | 'native_verify' | 'native_install'
       | 'npm_fallback'
       | 'node_downloading' | 'node_extracting' | 'node_complete'
       | 'git_downloading' | 'git_extracting' | 'git_complete';
}

export interface NodeEnvStatus {
  node_available: boolean;
  node_version: string | null;
  node_source: string | null; // "system" | "local"
  npm_available: boolean;
}

export interface ProvidersFile {
  version: number;
  activeProviderId: string | null;
  providers: {
    id: string;
    name: string;
    baseUrl: string;
    apiFormat: string;
    apiKey?: string;
    modelMappings: { tier: string; providerModel: string }[];
    extra_env?: Record<string, string>;
    preset?: string;
    createdAt: number;
    updatedAt: number;
  }[];
}

export interface UnifiedCommand {
  name: string;
  description: string;
  source: 'builtin' | 'global' | 'project';
  category: 'builtin' | 'command' | 'skill';
  has_args: boolean;
  path?: string;
  immediate: boolean;
  execution?: 'ui' | 'cli' | 'session';
}

// --- Bridge ---

export const bridge = {
  startSession: (params: StartSessionParams) =>
    invoke<SessionInfo>('start_claude_session', { params }),

  sendMessage: (sessionId: string, message: string) =>
    invoke<void>('send_message', { sessionId, message }),

  sendStdin: (sessionId: string, message: string) =>
    invoke<void>('send_stdin', { sessionId, message }),

  sendRawStdin: (sessionId: string, message: string) =>
    invoke<void>('send_raw_stdin', { sessionId, message }),

  killSession: (sessionId: string) =>
    invoke<void>('kill_session', { sessionId }),

  /** TK-329: List all active stdinIds from backend ProcessManager.
   *  Used after refresh to detect orphaned processes. */
  listActiveProcesses: () =>
    invoke<string[]>('list_active_processes'),

  abortSession: (sessionId: string) =>
    invoke<void>('abort_session', { sessionId }),

  trackSession: (sessionId: string) =>
    invoke<void>('track_session', { sessionId }),

  deleteSession: (sessionId: string, sessionPath: string) =>
    invoke<void>('delete_session', { sessionId, sessionPath }),

  listSessions: () =>
    invoke<SessionListItem[]>('list_sessions'),

  searchSessions: (query: string) =>
    invoke<ContentSearchResult[]>('search_sessions', { query }),

  loadSession: (path: string) =>
    invoke<any[]>('load_session', { path }),

  openInVscode: (path: string) =>
    invoke<void>('open_in_vscode', { path }),

  revealInFinder: (path: string) =>
    invoke<void>('reveal_in_finder', { path }),

  openWithDefaultApp: (path: string) =>
    invoke<void>('open_with_default_app', { path }),

  shareFile: (path: string) =>
    invoke<void>('share_file', { path }),

  shareToWechat: (path: string) =>
    invoke<void>('share_to_wechat', { path }),

  readFileTree: (path: string, depth?: number) =>
    invoke<FileNode[]>('read_file_tree', { path, depth }),

  readFileContent: (path: string, tabId?: string) =>
    invoke<string>('read_file_content', { path, tabId: tabId ?? null }),

  writeFileContent: (path: string, content: string, tabId?: string) =>
    invoke<void>('write_file_content', { path, content, tabId: tabId ?? null }),

  copyFile: (src: string, dest: string, tabId?: string) =>
    invoke<void>('copy_file', { src, dest, tabId: tabId ?? null }),

  renameFile: (src: string, dest: string, tabId?: string) =>
    invoke<void>('rename_file', { src, dest, tabId: tabId ?? null }),

  deleteFile: (path: string, tabId?: string) =>
    invoke<void>('delete_file', { path, tabId: tabId ?? null }),

  createDirectory: (path: string, tabId?: string) =>
    invoke<void>('create_directory', { path, tabId: tabId ?? null }),

  /** Add a path grant for the given tab (authorize external file access). */
  addPathGrant: (tabId: string, path: string) =>
    invoke<void>('add_path_grant', { tabId, path }),

  /** Revoke all grants for the given tab (called on tab close / teardown). */
  clearPathGrants: (tabId: string) =>
    invoke<void>('clear_path_grants', { tabId }),

  /** Decode a ~/.claude/projects/ directory name back to its source path.
   *  Uses the filesystem-aware Rust decoder instead of naive `.replace('-', '/')`. */
  decodeProjectDir: (encoded: string) =>
    invoke<string>('decode_project_dir', { encoded }),

  getHomeDir: () =>
    invoke<string>('get_home_dir'),

  exportSessionMarkdown: (path: string, outputPath: string, conversationOnly = false) =>
    invoke<void>('export_session_markdown', { path, outputPath, conversationOnly }),

  exportSessionJson: (path: string, outputPath: string) =>
    invoke<void>('export_session_json', { path, outputPath }),

  listRecentProjects: () =>
    invoke<RecentProject[]>('list_recent_projects'),

  watchDirectory: (path: string) =>
    invoke<void>('watch_directory', { path }),

  unwatchDirectory: (path: string) =>
    invoke<void>('unwatch_directory', { path }),

  saveTempFile: (name: string, data: number[], cwd?: string) =>
    invoke<string>('save_temp_file', { name, data, cwd: cwd || null }),

  getFileSize: (path: string, tabId?: string) =>
    invoke<number>('get_file_size', { path, tabId: tabId ?? null }),

  readFileBase64: (path: string, tabId?: string) =>
    invoke<string>('read_file_base64', { path, tabId: tabId ?? null }),

  /** Check if app has file system access to a directory (macOS TCC detection) */
  checkFileAccess: (path: string) =>
    invoke<boolean>('check_file_access', { path }),

  // Slash commands
  listSlashCommands: (cwd?: string) =>
    invoke<SlashCommand[]>('list_slash_commands', { cwd }),

  // Skills
  listSkills: (cwd?: string) =>
    invoke<SkillInfo[]>('list_skills', { cwd }),

  readSkill: (path: string, tabId?: string) =>
    invoke<string>('read_skill', { path, tabId: tabId ?? null }),

  writeSkill: (path: string, content: string, tabId?: string) =>
    invoke<void>('write_skill', { path, content, tabId: tabId ?? null }),

  deleteSkill: (path: string, tabId?: string) =>
    invoke<void>('delete_skill', { path, tabId: tabId ?? null }),

  toggleSkillEnabled: (path: string, enabled: boolean, tabId?: string) =>
    invoke<void>('toggle_skill_enabled', { path, enabled, tabId: tabId ?? null }),

  // Unified commands (commands + skills)
  listAllCommands: (cwd?: string) =>
    invoke<UnifiedCommand[]>('list_all_commands', { cwd }),

  // Git commands (safe, allowlisted operations only)
  runGitCommand: (cwd: string, args: string[]) =>
    invoke<string>('run_git_command', { cwd, args }),

  // Rewind files via SDK control protocol (fast, in-process) with CLI spawn fallback
  rewindFiles: (stdinId: string, userMessageId: string, sessionId: string, cwd: string) =>
    invoke<void>('send_control_request', {
      sessionId: stdinId,
      subtype: 'rewind_files',
      payload: { user_message_id: userMessageId },
    }).catch(() =>
      // Fallback: spawn new CLI process if stdin pipe not available
      invoke<string>('rewind_files', { sessionId, checkpointUuid: userMessageId, cwd }),
    ),

  // Set macOS dock icon from base64-encoded PNG
  setDockIcon: (pngBase64: string) =>
    invoke<void>('set_dock_icon', { pngBase64 }),

  // Run a Claude CLI subcommand as a one-shot process (e.g. `claude doctor`)
  runClaudeCommand: (subcommand: string, cwd?: string) =>
    invoke<string>('run_claude_command', { subcommand, cwd }),

  // Setup: CLI detection, installation & login
  checkClaudeCli: () =>
    invoke<CliStatus>('check_claude_cli'),

  /** Scan all CLI installations with version/issues for diagnostic UI */
  diagnoseCli: () =>
    invoke<CliCandidate[]>('diagnose_cli'),

  /** Remove selected CLI installations (only auto-deletes app-local tier) */
  cleanupOldCli: (targets: string[]) =>
    invoke<CleanupResult>('cleanup_old_cli', { targets }),

  pinCli: (path: string) => invoke<void>('pin_cli', { path }),
  unpinCli: () => invoke<void>('unpin_cli'),
  getPinnedCli: () => invoke<string | null>('get_pinned_cli'),
  injectCliPath: (path: string) => invoke<string>('inject_cli_path', { path }),
  deleteCli: (path: string) => invoke<string>('delete_cli', { path }),

  /** Scan all discoverable Claude CLIs and remove any that fail with
   *  Windows error 193 ("不支持的 16 位应用程序" / corrupt .exe).
   *  No-op on non-Windows. */
  repairCli: () =>
    invoke<{ scanned: string[]; removed: string[]; notes: string[] }>('repair_cli'),

  installClaudeCli: () =>
    invoke<void>('install_claude_cli'),

  /** Update CLI to latest version via npm (bypasses "already installed" skip) */
  updateClaudeCli: () =>
    invoke<string>('update_claude_cli'),

  /** Check if a newer CLI version is available */
  checkCliUpdate: () =>
    invoke<{ current: string | null; latest: string | null; update_available: boolean }>('check_cli_update'),

  checkNodeEnv: () =>
    invoke<NodeEnvStatus>('check_node_env'),

  installNodeEnv: () =>
    invoke<void>('install_node_env'),

  startClaudeLogin: () =>
    invoke<void>('start_claude_login'),

  checkClaudeAuth: () =>
    invoke<AuthStatus>('check_claude_auth'),

  openTerminalLogin: () =>
    invoke<void>('open_terminal_login'),

  // Session custom names (persisted to ~/.claude/tokenicode_session_names.json)
  loadCustomPreviews: () =>
    invoke<Record<string, string>>('load_custom_previews'),

  saveCustomPreviews: (data: Record<string, string>) =>
    invoke<void>('save_custom_previews', { data }),

  // Pinned sessions (persisted to ~/.tokenicode/pinned.json)
  loadPinnedSessions: () =>
    invoke<string[]>('load_pinned_sessions').catch(() => []),

  savePinnedSessions: (data: string[]) =>
    invoke<void>('save_pinned_sessions', { data }).catch(() => {}),

  // Archived sessions (persisted to ~/.tokenicode/archived.json)
  loadArchivedSessions: () =>
    invoke<string[]>('load_archived_sessions').catch(() => []),

  saveArchivedSessions: (data: string[]) =>
    invoke<void>('save_archived_sessions', { data }).catch(() => {}),

  // AI title generation (spawns separate CLI process, no channel interference)
  generateSessionTitle: (userMessage: string, assistantMessage: string, providerId?: string) =>
    invoke<string | null>('generate_session_title', { userMessage, assistantMessage, providerId: providerId || null }),

  // --- Provider Management ---

  loadProviders: () =>
    invoke<ProvidersFile>('load_providers'),

  saveProviders: (data: ProvidersFile) =>
    invoke<void>('save_providers', { data }),

  testProviderConnection: (baseUrl: string, apiFormat: string, apiKey: string, model: string, proxyUrl?: string) =>
    invoke<ConnectionTestResult>('test_provider_connection', { baseUrl, apiFormat, apiKey, model, proxyUrl: proxyUrl || null }),


  // --- SDK Control Protocol ---

  /** Respond to a structured permission request from CLI */
  respondPermission: (sessionId: string, requestId: string, allow: boolean, message?: string, toolUseId?: string, updatedInput?: Record<string, unknown>) =>
    invoke<void>('respond_permission', { sessionId, requestId, allow, message: message ?? null, toolUseId: toolUseId ?? null, updatedInput: updatedInput ?? null }),

  /** Send a runtime control command to change permission mode without restart */
  setPermissionMode: (sessionId: string, mode: string) =>
    invoke<void>('send_control_request', { sessionId, subtype: 'set_permission_mode', payload: { mode } }),

  /** Send a runtime control command to change model without restart */
  setModel: (sessionId: string, model: string | null) =>
    invoke<void>('send_control_request', { sessionId, subtype: 'set_model', payload: { model } }),

  /** Send a runtime interrupt command */
  interruptSession: (sessionId: string) =>
    invoke<void>('send_control_request', { sessionId, subtype: 'interrupt', payload: {} }),

  /** Submit user feedback via Feishu webhook (self-built app). */
  submitFeedback: (params: {
    description: string;
    screenshotBase64?: string;
    metadata: FeedbackMetadata;
  }) =>
    invoke<void>('submit_feedback', {
      description: params.description,
      screenshotBase64: params.screenshotBase64 ?? null,
      metadata: params.metadata,
    }),

  /** Check whether FEISHU_* env vars were baked in at build time. */
  feedbackIsConfigured: () => invoke<boolean>('feedback_is_configured'),
};

/** Metadata collected alongside user feedback for server-side diagnostics.
 *  OS / arch are filled in by the Rust side from std::env::consts. */
export interface FeedbackMetadata {
  app_name: string;
  app_version: string;
  locale?: string;
  provider_name?: string;
  model?: string;
  session_id?: string;
  user_contact?: string;
}

// --- SDK Control Protocol Types ---

export interface PermissionRequest {
  request_id: string;
  tool_name: string;
  input: Record<string, unknown>;
  description?: string;
  tool_use_id?: string;
}

// --- Event Listeners ---

/** @deprecated This listener has no corresponding backend emit — permission requests
 *  arrive through the main stream channel as `tokenicode_permission_request` messages.
 *  Kept for reference; will be removed in a future cleanup pass.
 *  @param stdinId - Desk-generated process key (NOT the CLI session UUID) */
export function onPermissionRequest(
  stdinId: string,
  callback: (req: PermissionRequest) => void,
): Promise<UnlistenFn> {
  const channel = `claude:permission_request:${stdinId}`;
  return listen<PermissionRequest>(
    channel,
    (event) => callback(event.payload),
  );
}

/** Listen for NDJSON stream events from a Claude CLI process.
 *  @param stdinId - Desk-generated process key (NOT the CLI session UUID) */
export function onClaudeStream(
  stdinId: string,
  callback: (message: any) => void,
): Promise<UnlistenFn> {
  return listen<any>(
    `claude:stream:${stdinId}`,
    (event) => callback(event.payload),
  );
}

/** Listen for stderr output from a Claude CLI process.
 *  @param stdinId - Desk-generated process key (NOT the CLI session UUID) */
export function onClaudeStderr(
  stdinId: string,
  callback: (line: string) => void,
): Promise<UnlistenFn> {
  return listen<string>(
    `claude:stderr:${stdinId}`,
    (event) => callback(event.payload),
  );
}

/** Listen for process exit events.
 *  @param stdinId - Desk-generated process key (NOT the CLI session UUID) */
export function onSessionExit(
  stdinId: string,
  callback: (code: number | null) => void,
): Promise<UnlistenFn> {
  return listen<number | null>(
    `claude:exit:${stdinId}`,
    (event) => callback(event.payload),
  );
}

export function onSetupInstallOutput(
  callback: (event: SetupOutputEvent) => void,
): Promise<UnlistenFn> {
  return listen<SetupOutputEvent>(
    'setup:install:output',
    (event) => callback(event.payload),
  );
}

export function onSetupInstallExit(
  callback: (event: SetupExitEvent) => void,
): Promise<UnlistenFn> {
  return listen<SetupExitEvent>(
    'setup:install:exit',
    (event) => callback(event.payload),
  );
}

export function onSetupLoginOutput(
  callback: (event: SetupOutputEvent) => void,
): Promise<UnlistenFn> {
  return listen<SetupOutputEvent>(
    'setup:login:output',
    (event) => callback(event.payload),
  );
}

export function onSetupLoginExit(
  callback: (event: SetupExitEvent) => void,
): Promise<UnlistenFn> {
  return listen<SetupExitEvent>(
    'setup:login:exit',
    (event) => callback(event.payload),
  );
}

export function onDownloadProgress(
  callback: (event: DownloadProgressEvent) => void,
): Promise<UnlistenFn> {
  return listen<DownloadProgressEvent>(
    'setup:download:progress',
    (event) => callback(event.payload),
  );
}

export function onFileChange(
  callback: (event: FileChangeEvent) => void,
): Promise<UnlistenFn> {
  return listen<FileChangeEvent>(
    'fs:change',
    (event) => callback(event.payload),
  );
}
