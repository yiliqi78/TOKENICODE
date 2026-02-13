import { useEffect, useCallback } from 'react';
import { useFileStore } from '../../stores/fileStore';
import { useSettingsStore } from '../../stores/settingsStore';
import { open } from '@tauri-apps/plugin-dialog';
import { useT } from '../../lib/i18n';

/**
 * One-time project selector shown before a project is chosen.
 * Once a project is selected this component is unmounted by the parent.
 */
export function ProjectSelector() {
  const t = useT();
  const setWorkingDirectory = useSettingsStore((s) => s.setWorkingDirectory);
  const recentProjects = useFileStore((s) => s.recentProjects);
  const fetchProjects = useFileStore((s) => s.fetchRecentProjects);

  useEffect(() => {
    fetchProjects();
  }, []);

  const handlePickFolder = useCallback(async () => {
    const selected = await open({
      directory: true,
      multiple: false,
      title: t('project.selectFolder'),
    });
    if (selected) {
      setWorkingDirectory(selected as string);
    }
  }, [setWorkingDirectory, t]);

  return (
    <div className="flex items-center gap-2 flex-wrap">
      {/* Browse folder chip */}
      <button
        onClick={handlePickFolder}
        className="inline-flex items-center gap-1.5 px-3 py-1.5
          rounded-lg border border-dashed border-border-subtle
          text-xs text-text-tertiary
          hover:border-accent hover:text-accent
          hover:bg-accent/5 transition-smooth"
      >
        <svg width="12" height="12" viewBox="0 0 16 16" fill="none"
          stroke="currentColor" strokeWidth="1.5" className="flex-shrink-0">
          <path d="M2 4h4l2 2h6v7H2V4z" />
          <path d="M8 8v4M6 10h4" strokeLinecap="round" />
        </svg>
        {t('project.selectBtn')}
      </button>

      {/* Recent project chips */}
      {recentProjects.slice(0, 5).map((project) => (
        <button
          key={project.path}
          onClick={() => setWorkingDirectory(project.path)}
          className="inline-flex items-center gap-1.5 px-3 py-1.5
            rounded-lg border border-border-subtle text-xs
            text-text-muted hover:border-border-focus
            hover:text-text-primary transition-smooth"
          title={project.shortPath}
        >
          <svg width="11" height="11" viewBox="0 0 16 16" fill="none"
            stroke="currentColor" strokeWidth="1.5"
            className="flex-shrink-0 text-text-tertiary">
            <path d="M2 4h4l2 2h6v7H2V4z" />
          </svg>
          {project.name}
        </button>
      ))}
    </div>
  );
}
