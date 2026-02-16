import { useEffect, useRef } from 'react';
import { AppShell } from './components/layout/AppShell';
import { Sidebar } from './components/layout/Sidebar';
import { ChatPanel } from './components/chat/ChatPanel';
import { SecondaryPanel } from './components/layout/SecondaryPanel';
import { CommandPalette } from './components/commands/CommandPalette';
import { SettingsPanel } from './components/settings/SettingsPanel';
import { ImageLightbox } from './components/shared/ImageLightbox';
import { useSettingsStore } from './stores/settingsStore';
import type { ColorTheme, Theme } from './stores/settingsStore';
import { useFileStore } from './stores/fileStore';
import { bridge, onFileChange } from './lib/tauri-bridge';
import './App.css';

/** Accent colors per theme for the slash in the icon */
const THEME_ACCENT_COLORS: Record<ColorTheme, string> = {
  black: '#FFFFFF',
  blue: '#4E80F7',
  orange: '#C47252',
  green: '#57A64B',
};

/** Render the app icon SVG: black bg, white brackets, accent-colored slash — return base64 PNG */
function renderIconPng(accentColor: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const size = 512;
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="-20.75 -20.75 212.5 212.5">
<rect width="171" height="171" rx="38.5" fill="#000000"/>
<path d="M66.7913 58.7327L40.3284 85.1946L66.7913 111.657L57.5295 120.919L21.8049 85.1946L57.5295 49.471L66.7913 58.7327Z" fill="white"/>
<path d="M111.497 49.471L147.222 85.1946L111.497 120.919L102.236 111.657L128.698 85.1946L102.236 58.7327L111.497 49.471Z" fill="white"/>
<path d="M90.0113 39.9192L102.011 39.9192L79.2356 129.919L67.2356 129.919L79.2356 81.9192L90.0113 39.9192Z" fill="${accentColor}"/>
</svg>`;
    const blob = new Blob([svg], { type: 'image/svg+xml' });
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = size;
      canvas.height = size;
      const ctx = canvas.getContext('2d')!;
      ctx.drawImage(img, 0, 0, size, size);
      URL.revokeObjectURL(url);
      const dataUrl = canvas.toDataURL('image/png');
      // Strip "data:image/png;base64," prefix
      resolve(dataUrl.split(',')[1]);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Failed to render icon'));
    };
    img.src = url;
  });
}

async function updateDockIcon(colorTheme: ColorTheme, _theme: Theme) {
  try {
    const accentColor = THEME_ACCENT_COLORS[colorTheme];
    const pngBase64 = await renderIconPng(accentColor);
    await bridge.setDockIcon(pngBase64);
  } catch {
    // Silently ignore on non-macOS or errors
  }
}

function App() {
  const theme = useSettingsStore((s) => s.theme);
  const colorTheme = useSettingsStore((s) => s.colorTheme);
  const fontSize = useSettingsStore((s) => s.fontSize);
  const settingsOpen = useSettingsStore((s) => s.settingsOpen);
  const workingDirectory = useSettingsStore((s) => s.workingDirectory);
  const loadTree = useFileStore((s) => s.loadTree);
  const refreshTree = useFileStore((s) => s.refreshTree);
  const markFileChanged = useFileStore((s) => s.markFileChanged);
  const prevDirRef = useRef<string | null>(null);

  // Disable browser context menu globally (native app feel)
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      // Allow context menu only in input fields and textareas
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA'
        || target.isContentEditable) return;
      e.preventDefault();
    };
    document.addEventListener('contextmenu', handler);
    return () => document.removeEventListener('contextmenu', handler);
  }, []);

  // Apply dark/light mode class to document
  useEffect(() => {
    const root = document.documentElement;
    if (theme === 'dark') {
      root.classList.add('dark');
    } else if (theme === 'light') {
      root.classList.remove('dark');
    } else {
      const mq = window.matchMedia('(prefers-color-scheme: dark)');
      const apply = () => {
        if (mq.matches) root.classList.add('dark');
        else root.classList.remove('dark');
      };
      apply();
      mq.addEventListener('change', apply);
      return () => mq.removeEventListener('change', apply);
    }
  }, [theme]);

  // Apply color theme class to document
  useEffect(() => {
    const root = document.documentElement;
    root.classList.remove('theme-blue', 'theme-orange', 'theme-green');
    if (colorTheme === 'blue') {
      root.classList.add('theme-blue');
    } else if (colorTheme === 'orange') {
      root.classList.add('theme-orange');
    } else if (colorTheme === 'green') {
      root.classList.add('theme-green');
    }
    // 'black' is the default — no class needed
  }, [colorTheme]);

  // Update macOS dock icon when color theme changes
  useEffect(() => {
    updateDockIcon(colorTheme, theme);
  }, [colorTheme, theme]);

  // Apply font size to document root
  useEffect(() => {
    document.documentElement.style.fontSize = `${fontSize}px`;
  }, [fontSize]);

  // Cmd+/- global shortcut for font size
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey)) return;
      if (e.key === '=' || e.key === '+') {
        e.preventDefault();
        useSettingsStore.getState().increaseFontSize();
      } else if (e.key === '-') {
        e.preventDefault();
        useSettingsStore.getState().decreaseFontSize();
      } else if (e.key === '0') {
        e.preventDefault();
        useSettingsStore.getState().setFontSize(14);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  // Load file tree + start watcher when working directory changes
  useEffect(() => {
    if (!workingDirectory) return;

    // Unwatch previous directory
    if (prevDirRef.current && prevDirRef.current !== workingDirectory) {
      bridge.unwatchDirectory(prevDirRef.current).catch(() => {});
    }
    prevDirRef.current = workingDirectory;

    // Load tree and start watching
    loadTree(workingDirectory);
    bridge.watchDirectory(workingDirectory).catch(console.error);

    return () => {
      bridge.unwatchDirectory(workingDirectory).catch(() => {});
    };
  }, [workingDirectory]);

  // Listen for file change events from the watcher
  // Debounce tree refresh for created/removed events (structure changes)
  const refreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const unlisten = onFileChange((event) => {
      for (const filePath of event.paths) {
        markFileChanged(filePath, event.kind);
      }

      // When files are created or removed, the tree structure changes —
      // debounce a full tree reload (300ms to batch rapid changes)
      if (event.kind === 'created' || event.kind === 'removed') {
        if (refreshTimerRef.current) clearTimeout(refreshTimerRef.current);
        refreshTimerRef.current = setTimeout(() => {
          refreshTree();
          refreshTimerRef.current = null;
        }, 300);
      }
    });
    return () => {
      unlisten.then((fn) => fn());
      if (refreshTimerRef.current) clearTimeout(refreshTimerRef.current);
    };
  }, [markFileChanged, refreshTree]);

  return (
    <>
      <AppShell
        sidebar={<Sidebar />}
        main={<ChatPanel />}
        secondary={<SecondaryPanel />}
      />
      <CommandPalette />
      {settingsOpen && <SettingsPanel />}
      <ImageLightbox />
    </>
  );
}

export default App;
