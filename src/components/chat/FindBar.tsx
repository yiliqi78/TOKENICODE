import { useEffect, useRef } from 'react';

interface FindBarProps {
  query: string;
  setQuery: (q: string) => void;
  matchIndex: number;
  matchCount: number;
  next: () => void;
  prev: () => void;
  close: () => void;
}

export function FindBar({ query, setQuery, matchIndex, matchCount, next, prev, close }: FindBarProps) {
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    // Auto-focus on mount
    requestAnimationFrame(() => inputRef.current?.focus());
  }, []);

  return (
    <div className="absolute top-2 right-4 z-50 flex items-center gap-1.5 px-3 py-1.5 rounded-lg shadow-md
      bg-bg-card border border-border text-text-primary text-[13px]"
      style={{ minWidth: 260 }}
    >
      <input
        ref={inputRef}
        type="text"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            e.shiftKey ? prev() : next();
          }
          if (e.key === 'Escape') {
            e.preventDefault();
            close();
          }
        }}
        placeholder="查找…"
        className="flex-1 min-w-0 bg-transparent outline-none placeholder:text-text-muted"
      />
      <span className="text-text-tertiary text-[12px] whitespace-nowrap tabular-nums">
        {query ? `${matchCount > 0 ? matchIndex + 1 : 0}/${matchCount}` : ''}
      </span>
      <button
        onClick={prev}
        disabled={matchCount === 0}
        className="p-0.5 rounded hover:bg-bg-secondary disabled:opacity-30 transition-colors"
        title="上一个 (Shift+Enter)"
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="18 15 12 9 6 15" />
        </svg>
      </button>
      <button
        onClick={next}
        disabled={matchCount === 0}
        className="p-0.5 rounded hover:bg-bg-secondary disabled:opacity-30 transition-colors"
        title="下一个 (Enter)"
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>
      <button
        onClick={close}
        className="p-0.5 rounded hover:bg-bg-secondary transition-colors ml-0.5"
        title="关闭 (Esc)"
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
        </svg>
      </button>
    </div>
  );
}
