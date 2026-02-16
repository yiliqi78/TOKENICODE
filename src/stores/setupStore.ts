import { create } from 'zustand';

export type SetupStep =
  | 'checking'
  | 'not_installed'
  | 'installing'
  | 'install_failed'
  | 'installed'
  | 'login_needed'
  | 'logging_in'
  | 'login_failed'
  | 'ready'
  | 'skipped';

interface SetupState {
  step: SetupStep;
  installOutput: string[];
  loginOutput: string[];
  error: string | null;
  cliVersion: string | null;
  cliPath: string | null;

  setStep: (step: SetupStep) => void;
  appendInstallOutput: (line: string) => void;
  appendLoginOutput: (line: string) => void;
  setError: (error: string | null) => void;
  setCliInfo: (version: string | null, path: string | null) => void;
  reset: () => void;
}

export const useSetupStore = create<SetupState>()((set) => ({
  step: 'checking',
  installOutput: [],
  loginOutput: [],
  error: null,
  cliVersion: null,
  cliPath: null,

  setStep: (step) => set({ step }),

  appendInstallOutput: (line) =>
    set((state) => ({ installOutput: [...state.installOutput, line] })),

  appendLoginOutput: (line) =>
    set((state) => ({ loginOutput: [...state.loginOutput, line] })),

  setError: (error) => set({ error }),

  setCliInfo: (version, path) =>
    set({ cliVersion: version, cliPath: path }),

  reset: () =>
    set({
      step: 'checking',
      installOutput: [],
      loginOutput: [],
      error: null,
      cliVersion: null,
      cliPath: null,
    }),
}));
