import { useEffect, useState, useCallback, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useSkillStore } from '../../stores/skillStore';
import { useFileStore } from '../../stores/fileStore';
import { useCommandStore } from '../../stores/commandStore';
import { useSettingsStore } from '../../stores/settingsStore';
import { bridge } from '../../lib/tauri-bridge';
import { useT } from '../../lib/i18n';
import type { SkillInfo } from '../../lib/tauri-bridge';

export function SkillsPanel() {
  const t = useT();
  const skills = useSkillStore((s) => s.skills);
  const isLoading = useSkillStore((s) => s.isLoading);
  const fetchSkills = useSkillStore((s) => s.fetchSkills);
  const deleteSkill = useSkillStore((s) => s.deleteSkill);
  const toggleEnabled = useSkillStore((s) => s.toggleEnabled);
  const workingDirectory = useSettingsStore((s) => s.workingDirectory);
  const selectFile = useFileStore((s) => s.selectFile);
  const selectedFile = useFileStore((s) => s.selectedFile);

  const [searchQuery, setSearchQuery] = useState('');
  const searchRef = useRef<HTMLInputElement>(null);

  // Context menu (triggered by "..." button)
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    skill: SkillInfo;
  } | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  // Fetch skills on mount and when working directory changes
  useEffect(() => {
    fetchSkills(workingDirectory || undefined);
  }, [workingDirectory, fetchSkills]);

  // Close context menu on outside click
  useEffect(() => {
    if (!contextMenu) return;
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setContextMenu(null);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [contextMenu]);

  // Close context menu on Escape
  useEffect(() => {
    if (!contextMenu) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setContextMenu(null);
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [contextMenu]);

  // Filter skills by search query
  const filteredSkills = skills.filter((s) =>
    s.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    s.description.toLowerCase().includes(searchQuery.toLowerCase())
  );

  // Group skills by scope
  const globalSkills = filteredSkills.filter((s) => s.scope === 'global');
  const projectSkills = filteredSkills.filter((s) => s.scope === 'project');

  const handleSelect = useCallback((skill: SkillInfo) => {
    selectFile(skill.path);
  }, [selectFile]);

  const handleOpenMenu = useCallback((e: React.MouseEvent, skill: SkillInfo) => {
    e.preventDefault();
    e.stopPropagation();
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const menuWidth = 180;
    const menuHeight = 220; // approximate height of 5 menu items
    let x = rect.left;
    let y = rect.bottom + 4;
    // Keep menu within viewport horizontally
    if (x + menuWidth > window.innerWidth) {
      x = rect.right - menuWidth;
    }
    // Keep menu within viewport vertically
    if (y + menuHeight > window.innerHeight) {
      y = rect.top - menuHeight - 4;
    }
    setContextMenu({ x, y, skill });
  }, []);

  const handleUseInInput = useCallback((skill: SkillInfo) => {
    setContextMenu(null);
    useCommandStore.getState().setActivePrefix({
      name: `/${skill.name}`,
      description: skill.description,
      source: skill.scope,
      category: 'skill' as const,
      has_args: true,
      path: skill.path,
      immediate: false,
    });
  }, []);

  const handleEdit = useCallback((skill: SkillInfo) => {
    setContextMenu(null);
    selectFile(skill.path);
  }, [selectFile]);

  const handleDuplicate = useCallback(async (skill: SkillInfo) => {
    setContextMenu(null);
    try {
      const content = await bridge.readSkill(skill.path);
      const copyName = `${skill.name}-copy`;
      // Derive new path: replace the skill directory name
      const parentDir = skill.path.replace(/\/[^/]+\/SKILL\.md$/, '');
      const newPath = `${parentDir}/${copyName}/SKILL.md`;
      await bridge.writeSkill(newPath, content);
      await fetchSkills(workingDirectory || undefined);
    } catch (e) {
      console.error('Failed to duplicate skill:', e);
    }
  }, [fetchSkills, workingDirectory]);

  const handleRevealInFinder = useCallback((skill: SkillInfo) => {
    setContextMenu(null);
    bridge.revealInFinder(skill.path);
  }, []);

  const handleDelete = useCallback(async (skill: SkillInfo) => {
    setContextMenu(null);
    if (confirm(t('skills.confirmDelete'))) {
      await deleteSkill(skill);
    }
  }, [deleteSkill, t]);

  // Skill count
  const totalCount = filteredSkills.length;

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2
        border-b border-border-subtle">
        <div className="flex items-center gap-2 min-w-0">
          <svg width="12" height="12" viewBox="0 0 16 16" fill="none"
            stroke="currentColor" strokeWidth="1.5"
            className="text-accent flex-shrink-0">
            <path d="M8 1L1 4.5l7 3.5 7-3.5L8 1zM1 11.5l7 3.5 7-3.5M1 8l7 3.5L15 8" />
          </svg>
          <span className="text-xs font-semibold text-text-primary">
            {t('skills.title')}
          </span>
          <span className="text-[10px] text-text-muted flex-shrink-0">
            {totalCount}
          </span>
        </div>
        <button
          onClick={() => fetchSkills(workingDirectory || undefined)}
          className="p-1 rounded hover:bg-bg-secondary
            text-text-tertiary transition-smooth"
          title={t('skills.refresh')}
        >
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none"
            stroke="currentColor" strokeWidth="1.5">
            <path d="M1 6a5 5 0 019-2M11 6a5 5 0 01-9 2" />
            <path d="M10 1v3h-3M2 11V8h3" />
          </svg>
        </button>
      </div>

      {/* Search bar */}
      <div className="px-2 py-1.5 border-b border-border-subtle">
        <div className="relative">
          <svg width="12" height="12" viewBox="0 0 16 16" fill="none"
            stroke="currentColor" strokeWidth="1.5"
            className="absolute left-2 top-1/2 -translate-y-1/2 text-text-tertiary">
            <circle cx="7" cy="7" r="5" />
            <path d="M11 11l3 3" />
          </svg>
          <input
            ref={searchRef}
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder={t('skills.search')}
            className="w-full pl-7 pr-7 py-1 text-xs bg-bg-secondary/50
              border border-border-subtle rounded-lg text-text-primary
              placeholder:text-text-tertiary outline-none
              focus:border-border-focus focus:bg-bg-input
              transition-smooth"
          />
          {searchQuery && (
            <button
              onClick={() => setSearchQuery('')}
              className="absolute right-1.5 top-1/2 -translate-y-1/2
                p-0.5 rounded text-text-tertiary hover:text-text-primary
                transition-smooth"
            >
              <svg width="10" height="10" viewBox="0 0 10 10" fill="none"
                stroke="currentColor" strokeWidth="1.5">
                <path d="M2 2l6 6M8 2l-6 6" />
              </svg>
            </button>
          )}
        </div>
      </div>

      {/* Skills list */}
      <div className="flex-1 overflow-y-auto py-1">
        {isLoading ? (
          <div className="flex items-center justify-center py-8">
            <div className="w-5 h-5 border-2 border-accent/30
              border-t-accent rounded-full animate-spin" />
          </div>
        ) : filteredSkills.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-8
            text-text-tertiary text-xs gap-2">
            <svg width="32" height="32" viewBox="0 0 32 32" fill="none"
              stroke="currentColor" strokeWidth="1.2"
              className="text-text-tertiary/40">
              <path d="M16 4L4 10l12 6 12-6L16 4zM4 22l12 6 12-6M4 16l12 6 12-6" />
            </svg>
            <p className="text-xs text-text-tertiary leading-relaxed">
              {searchQuery ? 'No matching skills' : t('skills.empty')}
            </p>
          </div>
        ) : (
          <>
            {projectSkills.length > 0 && (
              <SkillGroup
                label={t('skills.project')}
                skills={projectSkills}
                selectedFile={selectedFile}
                onSelect={handleSelect}
                onOpenMenu={handleOpenMenu}
                onToggleEnabled={toggleEnabled}
                t={t}
              />
            )}
            {globalSkills.length > 0 && (
              <SkillGroup
                label={t('skills.global')}
                skills={globalSkills}
                selectedFile={selectedFile}
                onSelect={handleSelect}
                onOpenMenu={handleOpenMenu}
                onToggleEnabled={toggleEnabled}
                t={t}
              />
            )}
          </>
        )}
      </div>

      {/* Context menu — rendered via portal to escape overflow-hidden + backdrop-filter ancestors */}
      {contextMenu && createPortal(
        <div
          ref={menuRef}
          className="fixed z-[9999] min-w-[180px] py-1 rounded-xl border border-border-subtle
            bg-bg-card shadow-lg animate-fade-in"
          style={{ left: contextMenu.x, top: contextMenu.y }}
        >
          {/* Use in Input */}
          <button
            onClick={() => handleUseInInput(contextMenu.skill)}
            className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-text-primary
              hover:bg-bg-secondary transition-smooth text-left"
          >
            <svg width="12" height="12" viewBox="0 0 16 16" fill="none"
              stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"
              className="text-text-tertiary flex-shrink-0">
              <path d="M12 9v4H4V5h4" />
              <path d="M8 8l6-6M10 2h4v4" />
            </svg>
            {t('skills.useInInput')}
          </button>

          {/* Edit */}
          <button
            onClick={() => handleEdit(contextMenu.skill)}
            className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-text-primary
              hover:bg-bg-secondary transition-smooth text-left"
          >
            <svg width="12" height="12" viewBox="0 0 16 16" fill="none"
              stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"
              className="text-text-tertiary flex-shrink-0">
              <path d="M11.5 1.5l3 3L5 14H2v-3l9.5-9.5z" />
            </svg>
            {t('skills.edit')}
          </button>

          {/* Duplicate */}
          <button
            onClick={() => handleDuplicate(contextMenu.skill)}
            className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-text-primary
              hover:bg-bg-secondary transition-smooth text-left"
          >
            <svg width="12" height="12" viewBox="0 0 16 16" fill="none"
              stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"
              className="text-text-tertiary flex-shrink-0">
              <rect x="5" y="5" width="9" height="9" rx="1.5" />
              <path d="M11 5V3.5A1.5 1.5 0 009.5 2h-6A1.5 1.5 0 002 3.5v6A1.5 1.5 0 003.5 11H5" />
            </svg>
            {t('skills.duplicate')}
          </button>

          {/* Reveal in Finder */}
          <button
            onClick={() => handleRevealInFinder(contextMenu.skill)}
            className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-text-primary
              hover:bg-bg-secondary transition-smooth text-left"
          >
            <svg width="12" height="12" viewBox="0 0 16 16" fill="none"
              stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"
              className="text-text-tertiary flex-shrink-0">
              <path d="M2 4h5l2 2h5v7a1 1 0 01-1 1H3a1 1 0 01-1-1V4z" />
            </svg>
            {t('skills.revealInFinder')}
          </button>

          <div className="my-1 border-t border-border-subtle" />

          {/* Delete */}
          <button
            onClick={() => handleDelete(contextMenu.skill)}
            className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-red-500
              hover:bg-red-500/10 transition-smooth text-left"
          >
            <svg width="12" height="12" viewBox="0 0 16 16" fill="none"
              stroke="currentColor" strokeWidth="1.5"
              strokeLinecap="round" strokeLinejoin="round"
              className="flex-shrink-0">
              <path d="M2 4h12M5.333 4V2.667a1.333 1.333 0 011.334-1.334h2.666a1.333 1.333 0 011.334 1.334V4m2 0v9.333a1.333 1.333 0 01-1.334 1.334H4.667a1.333 1.333 0 01-1.334-1.334V4h9.334z" />
            </svg>
            {t('skills.delete')}
          </button>
        </div>,
        document.body
      )}
    </div>
  );
}

/* Collapsible skill group */
function SkillGroup({
  label,
  skills,
  selectedFile,
  onSelect,
  onOpenMenu,
  onToggleEnabled,
  t,
}: {
  label: string;
  skills: SkillInfo[];
  selectedFile: string | null;
  onSelect: (skill: SkillInfo) => void;
  onOpenMenu: (e: React.MouseEvent, skill: SkillInfo) => void;
  onToggleEnabled: (skill: SkillInfo) => void;
  t: (key: string) => string;
}) {
  const [collapsed, setCollapsed] = useState(false);

  return (
    <div className="mb-1">
      <button
        onClick={() => setCollapsed(!collapsed)}
        className="w-full flex items-center gap-2 px-3 py-1.5
          hover:bg-bg-secondary/50 rounded-lg transition-smooth"
      >
        <svg width="10" height="10" viewBox="0 0 10 10" fill="none"
          stroke="currentColor" strokeWidth="1.5"
          className={`text-text-tertiary transition-transform
            ${collapsed ? '' : 'rotate-90'}`}>
          <path d="M3 1l4 4-4 4" />
        </svg>
        <span className="text-[10px] font-medium text-text-tertiary uppercase tracking-wider flex-1 text-left">
          {label}
        </span>
        <span className="text-[10px] text-text-tertiary flex-shrink-0">
          {skills.length}
        </span>
      </button>

      {!collapsed && skills.map((skill) => (
        <SkillCard
          key={skill.path}
          skill={skill}
          isSelected={selectedFile === skill.path}
          onSelect={onSelect}
          onOpenMenu={onOpenMenu}
          onToggleEnabled={onToggleEnabled}
          t={t}
        />
      ))}
    </div>
  );
}

/* Skill card — richer display with tools, metadata, toggle */
function SkillCard({
  skill,
  isSelected,
  onSelect,
  onOpenMenu,
  onToggleEnabled,
  t,
}: {
  skill: SkillInfo;
  isSelected: boolean;
  onSelect: (skill: SkillInfo) => void;
  onOpenMenu: (e: React.MouseEvent, skill: SkillInfo) => void;
  onToggleEnabled: (skill: SkillInfo) => void;
  t: (key: string) => string;
}) {
  const isDisabled = skill.disable_model_invocation === true;

  return (
    <div
      onClick={() => onSelect(skill)}
      className={`mx-1.5 mb-1 px-2.5 py-2 rounded-lg cursor-pointer
        transition-smooth group border
        ${isDisabled ? 'opacity-50' : ''}
        ${isSelected
          ? 'bg-accent/10 border-accent/30'
          : 'border-transparent hover:bg-bg-secondary hover:border-border-subtle'
        }`}
    >
      {/* Row 1: Name + scope badge + actions */}
      <div className="flex items-center gap-1.5">
        <span className="text-xs leading-none flex-shrink-0 text-text-tertiary">◇</span>
        <span className={`text-[13px] truncate flex-1 ${
          isSelected ? 'text-accent' : 'text-text-primary'
        }`}>
          {skill.name}
        </span>
        <span className={`flex-shrink-0 w-3.5 h-3.5 rounded text-[8px]
          font-bold flex items-center justify-center
          ${skill.scope === 'global' ? 'bg-blue-500/20 text-blue-400' : 'bg-green-500/20 text-green-400'}`}>
          {skill.scope === 'global' ? 'G' : 'P'}
        </span>

        {/* Toggle switch */}
        <button
          onClick={(e) => { e.stopPropagation(); onToggleEnabled(skill); }}
          className="flex-shrink-0 ml-1"
          title={isDisabled ? t('skills.enable') : t('skills.disable')}
        >
          <div className={`w-6 h-3.5 rounded-full transition-colors relative
            ${isDisabled ? 'bg-text-tertiary/30' : 'bg-accent'}`}>
            <div className={`absolute top-0.5 w-2.5 h-2.5 rounded-full bg-white shadow-sm
              transition-transform ${isDisabled ? 'left-0.5' : 'left-[11px]'}`} />
          </div>
        </button>

        {/* "..." menu button */}
        <button
          onClick={(e) => onOpenMenu(e, skill)}
          className="flex-shrink-0 p-0.5 rounded opacity-0 group-hover:opacity-100
            hover:bg-bg-secondary transition-smooth text-text-tertiary"
        >
          <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor">
            <circle cx="4" cy="8" r="1.5" />
            <circle cx="8" cy="8" r="1.5" />
            <circle cx="12" cy="8" r="1.5" />
          </svg>
        </button>
      </div>

      {/* Row 2: Description (1-2 lines, truncated) */}
      <p className="text-[11px] text-text-muted mt-1 line-clamp-2 leading-relaxed pl-5">
        {skill.description}
      </p>

      {/* Row 3: Allowed tools as tag badges */}
      {skill.allowed_tools && skill.allowed_tools.length > 0 && (
        <div className="flex flex-wrap gap-1 mt-1.5 pl-5">
          {skill.allowed_tools.map((tool) => (
            <span
              key={tool}
              className="px-1.5 py-0.5 text-[9px] rounded-md
                bg-accent/10 text-accent font-medium"
            >
              {tool}
            </span>
          ))}
        </div>
      )}

      {/* Row 4: Metadata (model, context, version) */}
      {(skill.model || skill.context || skill.version) && (
        <div className="flex items-center gap-2 mt-1 pl-5 text-[9px] text-text-tertiary">
          {skill.model && (
            <span>{t('skills.model')}: {skill.model}</span>
          )}
          {skill.context && (
            <span>{t('skills.context')}: {skill.context}</span>
          )}
          {skill.version && (
            <span>{t('skills.version')}: {skill.version}</span>
          )}
        </div>
      )}
    </div>
  );
}
