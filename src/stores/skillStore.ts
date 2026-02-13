import { create } from 'zustand';
import { bridge, SkillInfo } from '../lib/tauri-bridge';

interface SkillState {
  skills: SkillInfo[];
  isLoading: boolean;

  // Selected skill for viewing/editing
  selectedSkill: SkillInfo | null;
  skillContent: string | null;
  isLoadingContent: boolean;

  // Edit state
  editContent: string | null;
  isSaving: boolean;

  // Actions
  fetchSkills: (cwd?: string) => Promise<void>;
  selectSkill: (skill: SkillInfo) => Promise<void>;
  clearSelection: () => void;
  setEditContent: (content: string) => void;
  saveSkill: () => Promise<void>;
  discardEdits: () => void;
  deleteSkill: (skill: SkillInfo) => Promise<void>;
  createSkill: (name: string, scope: 'global' | 'project', cwd: string, content: string) => Promise<void>;
  toggleEnabled: (skill: SkillInfo) => Promise<void>;
}

export const useSkillStore = create<SkillState>()((set, get) => ({
  skills: [],
  isLoading: false,
  selectedSkill: null,
  skillContent: null,
  isLoadingContent: false,
  editContent: null,
  isSaving: false,

  fetchSkills: async (cwd?: string) => {
    set({ isLoading: true });
    try {
      const skills = await bridge.listSkills(cwd);
      set({ skills, isLoading: false });
    } catch {
      set({ isLoading: false });
    }
  },

  selectSkill: async (skill: SkillInfo) => {
    const current = get().selectedSkill;
    if (current?.path === skill.path) {
      // Toggle off
      set({ selectedSkill: null, skillContent: null, editContent: null });
      return;
    }
    set({ selectedSkill: skill, skillContent: null, isLoadingContent: true, editContent: null });
    try {
      const content = await bridge.readSkill(skill.path);
      if (get().selectedSkill?.path === skill.path) {
        set({ skillContent: content, isLoadingContent: false });
      }
    } catch {
      if (get().selectedSkill?.path === skill.path) {
        set({ skillContent: '// Error loading skill', isLoadingContent: false });
      }
    }
  },

  clearSelection: () => set({ selectedSkill: null, skillContent: null, editContent: null }),

  setEditContent: (content: string) => set({ editContent: content }),

  saveSkill: async () => {
    const { selectedSkill, editContent } = get();
    if (!selectedSkill || editContent === null) return;
    set({ isSaving: true });
    try {
      await bridge.writeSkill(selectedSkill.path, editContent);
      set({ skillContent: editContent, editContent: null, isSaving: false });
    } catch {
      set({ isSaving: false });
    }
  },

  discardEdits: () => set({ editContent: null }),

  deleteSkill: async (skill: SkillInfo) => {
    try {
      await bridge.deleteSkill(skill.path);
      const { skills, selectedSkill } = get();
      set({
        skills: skills.filter((s) => s.path !== skill.path),
        ...(selectedSkill?.path === skill.path
          ? { selectedSkill: null, skillContent: null, editContent: null }
          : {}),
      });
    } catch (e) {
      console.error('Failed to delete skill:', e);
    }
  },

  createSkill: async (name: string, scope: 'global' | 'project', cwd: string, content: string) => {
    const home = await bridge.getHomeDir();
    const basePath = scope === 'global'
      ? `${home}/.claude/skills/${name}/SKILL.md`
      : `${cwd}/.claude/skills/${name}/SKILL.md`;
    try {
      await bridge.writeSkill(basePath, content);
      // Refresh the list
      await get().fetchSkills(cwd);
    } catch (e) {
      console.error('Failed to create skill:', e);
    }
  },

  toggleEnabled: async (skill: SkillInfo) => {
    const isCurrentlyDisabled = skill.disable_model_invocation === true;
    const newEnabled = isCurrentlyDisabled; // flip: disabled -> enabled, enabled -> disabled
    try {
      await bridge.toggleSkillEnabled(skill.path, newEnabled);
      // Optimistically update the local skills array
      const { skills } = get();
      set({
        skills: skills.map((s) =>
          s.path === skill.path
            ? { ...s, disable_model_invocation: newEnabled ? undefined : true }
            : s
        ),
      });
    } catch (e) {
      console.error('Failed to toggle skill:', e);
    }
  },
}));
