import { create } from 'zustand';
import { bridge, type UnifiedCommand } from '../lib/tauri-bridge';

interface CommandState {
  // All available commands (built-in + custom)
  commands: UnifiedCommand[];
  isLoading: boolean;

  // Prefix mode: when a custom command with $ARGUMENTS is selected
  activePrefix: UnifiedCommand | null;

  // Actions
  fetchCommands: (cwd?: string) => Promise<void>;
  setActivePrefix: (cmd: UnifiedCommand) => void;
  clearPrefix: () => void;
}

export const useCommandStore = create<CommandState>()((set) => ({
  commands: [],
  isLoading: false,
  activePrefix: null,

  fetchCommands: async (cwd?: string) => {
    set({ isLoading: true });
    try {
      const commands = await bridge.listAllCommands(cwd);
      set({ commands, isLoading: false });
    } catch (err) {
      console.error('[commandStore] fetchCommands failed:', err);
      set({ isLoading: false });
    }
  },

  setActivePrefix: (cmd) => set({ activePrefix: cmd }),
  clearPrefix: () => set({ activePrefix: null }),
}));
