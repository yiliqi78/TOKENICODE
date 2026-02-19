import { invoke } from '@tauri-apps/api/core';
import { listen, UnlistenFn } from '@tauri-apps/api/event';

// --- Types ---

export interface StartSessionParams {
  prompt: string;
  cwd: string;
  model?: string;
  session_id?: string;
  allowed_tools?: string[];
  dangerously_skip_permissions?: boolean;
  /** Resume an existing Claude CLI session by ID (for follow-up messages) */
  resume_session_id?: string;
  /** Enable extended thinking mode */
  thinking_enabled?: boolean;
}

export interface SessionInfo {
  session_id: string;
  pid: number;
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
}

export interface AuthStatus {
  authenticated: boolean;
}

export interface SetupOutputEvent {
  stream: 'stdout' | 'stderr';
  line: string;
}

export interface SetupExitEvent {
  code: number;
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

  killSession: (sessionId: string) =>
    invoke<void>('kill_session', { sessionId }),

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

  saveTempFile: (name: string, data: number[]) =>
    invoke<string>('save_temp_file', { name, data }),

  getFileSize: (path: string) =>
    invoke<number>('get_file_size', { path }),

  readFileBase64: (path: string) =>
    invoke<string>('read_file_base64', { path }),

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

  // File snapshot — capture file contents before a turn for code restore
  snapshotFiles: (paths: string[]) =>
    invoke<Record<string, string>>('snapshot_files', { paths }),

  // Restore file snapshot — write files back from snapshot, delete created files
  restoreSnapshot: (snapshot: Record<string, string>, createdPaths: string[]) =>
    invoke<void>('restore_snapshot', { snapshot, createdPaths }),

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

  startClaudeLogin: () =>
    invoke<void>('start_claude_login'),

  checkClaudeAuth: () =>
    invoke<AuthStatus>('check_claude_auth'),

  openTerminalLogin: () =>
    invoke<void>('open_terminal_login'),
};

// --- Event Listeners ---

export function onClaudeStream(
  sessionId: string,
  callback: (message: any) => void,
): Promise<UnlistenFn> {
  return listen<any>(
    `claude:stream:${sessionId}`,
    (event) => callback(event.payload),
  );
}

export function onClaudeStderr(
  sessionId: string,
  callback: (line: string) => void,
): Promise<UnlistenFn> {
  return listen<string>(
    `claude:stderr:${sessionId}`,
    (event) => callback(event.payload),
  );
}

export function onSessionExit(
  sessionId: string,
  callback: (code: number | null) => void,
): Promise<UnlistenFn> {
  return listen<number | null>(
    `claude:exit:${sessionId}`,
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

export function onFileChange(
  callback: (event: FileChangeEvent) => void,
): Promise<UnlistenFn> {
  return listen<FileChangeEvent>(
    'fs:change',
    (event) => callback(event.payload),
  );
}
