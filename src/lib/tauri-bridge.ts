import { invoke } from '@tauri-apps/api/core';
import { listen, UnlistenFn } from '@tauri-apps/api/event';

// --- Types ---

export interface StartSessionParams {
  prompt: string;
  cwd: string;
  model?: string;
  /** Desk-generated process key (stdinId) — used as key in Rust StdinManager/ProcessManager.
   *  NOT the Claude CLI session UUID (that comes back as SessionInfo.session_id). */
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
}

export interface SessionInfo {
  /** The Claude CLI's own conversation UUID (used for --resume).
   *  This is different from the stdinId (desk-generated process key). */
  session_id: string;
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
  git_bash_missing: boolean;
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

  readFileContent: (path: string) =>
    invoke<string>('read_file_content', { path }),

  writeFileContent: (path: string, content: string) =>
    invoke<void>('write_file_content', { path, content }),

  copyFile: (src: string, dest: string) =>
    invoke<void>('copy_file', { src, dest }),

  renameFile: (src: string, dest: string) =>
    invoke<void>('rename_file', { src, dest }),

  deleteFile: (path: string) =>
    invoke<void>('delete_file', { path }),

  createDirectory: (path: string) =>
    invoke<void>('create_directory', { path }),

  getHomeDir: () =>
    invoke<string>('get_home_dir'),

  exportSessionMarkdown: (path: string, outputPath: string) =>
    invoke<void>('export_session_markdown', { path, outputPath }),

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

  getFileSize: (path: string) =>
    invoke<number>('get_file_size', { path }),

  readFileBase64: (path: string) =>
    invoke<string>('read_file_base64', { path }),

  /** Check if app has file system access to a directory (macOS TCC detection) */
  checkFileAccess: (path: string) =>
    invoke<boolean>('check_file_access', { path }),

  // Slash commands
  listSlashCommands: (cwd?: string) =>
    invoke<SlashCommand[]>('list_slash_commands', { cwd }),

  // Skills
  listSkills: (cwd?: string) =>
    invoke<SkillInfo[]>('list_skills', { cwd }),

  readSkill: (path: string) =>
    invoke<string>('read_skill', { path }),

  writeSkill: (path: string, content: string) =>
    invoke<void>('write_skill', { path, content }),

  deleteSkill: (path: string) =>
    invoke<void>('delete_skill', { path }),

  toggleSkillEnabled: (path: string, enabled: boolean) =>
    invoke<void>('toggle_skill_enabled', { path, enabled }),

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

  installClaudeCli: () =>
    invoke<void>('install_claude_cli'),

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
    invoke<string>('generate_session_title', { userMessage, assistantMessage, providerId: providerId || null }),

  // --- Provider Management ---

  loadProviders: () =>
    invoke<ProvidersFile>('load_providers'),

  saveProviders: (data: ProvidersFile) =>
    invoke<void>('save_providers', { data }),

  testProviderConnection: (baseUrl: string, apiFormat: string, apiKey: string, model: string) =>
    invoke<ConnectionTestResult>('test_provider_connection', { baseUrl, apiFormat, apiKey, model }),


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
};

// --- SDK Control Protocol Types ---

export interface PermissionRequest {
  request_id: string;
  tool_name: string;
  input: Record<string, unknown>;
  description?: string;
  tool_use_id?: string;
}

// --- Event Listeners ---

/** Listen for structured permission requests from the SDK control protocol.
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
