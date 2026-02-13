import { create } from 'zustand';
import { bridge } from '../lib/tauri-bridge';

// --- Types ---

export interface McpServerConfig {
  command: string;
  args: string[];
  env: Record<string, string>;
  type: string;
}

export interface McpServer {
  name: string;
  config: McpServerConfig;
}

interface McpState {
  servers: McpServer[];
  isLoading: boolean;
  editingServer: string | null;
  isAdding: boolean;

  fetchServers: () => Promise<void>;
  addServer: (name: string, config: McpServerConfig) => Promise<void>;
  updateServer: (oldName: string, newName: string, config: McpServerConfig) => Promise<void>;
  deleteServer: (name: string) => Promise<void>;
  setEditing: (name: string | null) => void;
  setAdding: (adding: boolean) => void;
}

// --- Helpers ---

async function readClaudeJson(): Promise<Record<string, unknown>> {
  const home = await bridge.getHomeDir();
  const path = `${home}/.claude.json`;
  try {
    const content = await bridge.readFileContent(path);
    return JSON.parse(content);
  } catch {
    return {};
  }
}

async function writeClaudeJson(data: Record<string, unknown>): Promise<void> {
  const home = await bridge.getHomeDir();
  const path = `${home}/.claude.json`;
  await bridge.writeFileContent(path, JSON.stringify(data, null, 2));
}

function parseServers(mcpServers: Record<string, unknown> | undefined): McpServer[] {
  if (!mcpServers || typeof mcpServers !== 'object') return [];
  return Object.entries(mcpServers).map(([name, raw]) => {
    const cfg = raw as Record<string, unknown>;
    return {
      name,
      config: {
        command: (cfg.command as string) || '',
        args: Array.isArray(cfg.args) ? (cfg.args as string[]) : [],
        env: (cfg.env as Record<string, string>) || {},
        type: (cfg.type as string) || 'stdio',
      },
    };
  });
}

// --- Store ---

export const useMcpStore = create<McpState>()((set) => ({
  servers: [],
  isLoading: false,
  editingServer: null,
  isAdding: false,

  fetchServers: async () => {
    set({ isLoading: true });
    try {
      const json = await readClaudeJson();
      const servers = parseServers(json.mcpServers as Record<string, unknown> | undefined);
      set({ servers, isLoading: false });
    } catch {
      set({ isLoading: false });
    }
  },

  addServer: async (name, config) => {
    const json = await readClaudeJson();
    const mcpServers = (json.mcpServers as Record<string, unknown>) || {};
    mcpServers[name] = {
      command: config.command,
      args: config.args,
      env: Object.keys(config.env).length > 0 ? config.env : undefined,
      type: config.type,
    };
    json.mcpServers = mcpServers;
    await writeClaudeJson(json);
    const servers = parseServers(mcpServers);
    set({ servers, isAdding: false });
  },

  updateServer: async (oldName, newName, config) => {
    const json = await readClaudeJson();
    const mcpServers = (json.mcpServers as Record<string, unknown>) || {};
    if (oldName !== newName) {
      delete mcpServers[oldName];
    }
    mcpServers[newName] = {
      command: config.command,
      args: config.args,
      env: Object.keys(config.env).length > 0 ? config.env : undefined,
      type: config.type,
    };
    json.mcpServers = mcpServers;
    await writeClaudeJson(json);
    const servers = parseServers(mcpServers);
    set({ servers, editingServer: null });
  },

  deleteServer: async (name) => {
    const json = await readClaudeJson();
    const mcpServers = (json.mcpServers as Record<string, unknown>) || {};
    delete mcpServers[name];
    json.mcpServers = mcpServers;
    await writeClaudeJson(json);
    const servers = parseServers(mcpServers);
    set({ servers });
  },

  setEditing: (name) => set({ editingServer: name, isAdding: false }),
  setAdding: (adding) => set({ isAdding: adding, editingServer: null }),
}));
