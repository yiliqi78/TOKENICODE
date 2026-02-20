import { create } from 'zustand';

export type SetupStep =
  | 'checking'
  | 'not_installed'
  | 'installing'
  | 'install_failed'
  | 'installed';

interface SetupState {
  step: SetupStep;
  error: string | null;
  cliVersion: string | null;
  cliPath: string | null;

  setStep: (step: SetupStep) => void;
  setError: (error: string | null) => void;
  setCliInfo: (version: string | null, path: string | null) => void;
  reset: () => void;
}

export const useSetupStore = create<SetupState>()((set) => ({
  step: 'checking',
  error: null,
  cliVersion: null,
  cliPath: null,

  setStep: (step) => set({ step }),

  setError: (error) => set({ error }),

  setCliInfo: (version, path) =>
    set({ cliVersion: version, cliPath: path }),

  reset: () =>
    set({
      step: 'checking',
      error: null,
      cliVersion: null,
      cliPath: null,
    }),
}));
