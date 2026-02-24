/**
 * React NodeView component for the FileChip tiptap node.
 *
 * Renders an inline chip with:
 * - File icon + short label
 * - Hover tooltip showing the full path
 * - Click to open the file in the built-in editor
 */
import { type NodeViewProps, NodeViewWrapper } from '@tiptap/react';
import { useCallback, useRef, useState } from 'react';

export function FileChipView({ node }: NodeViewProps) {
  const { fullPath, label } = node.attrs as { fullPath: string; label: string };
  const [tooltip, setTooltip] = useState<{ x: number; y: number } | null>(null);
  const chipRef = useRef<HTMLSpanElement>(null);

  const handleClick = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      window.dispatchEvent(
        new CustomEvent('tokenicode:open-file', { detail: fullPath }),
      );
    },
    [fullPath],
  );

  const handleMouseEnter = useCallback(() => {
    if (!chipRef.current) return;
    const rect = chipRef.current.getBoundingClientRect();
    setTooltip({ x: rect.left + rect.width / 2, y: rect.top });
  }, []);

  const handleMouseLeave = useCallback(() => setTooltip(null), []);

  const isDir = fullPath.endsWith('/');
  const icon = isDir ? '📁' : '📄';

  return (
    <NodeViewWrapper as="span" className="inline align-baseline">
      <span
        ref={chipRef}
        contentEditable={false}
        className="inline-flex items-center gap-1 px-1.5 py-0.5 mx-0.5
          bg-accent/10 border border-accent/25 rounded-md
          text-xs text-accent font-medium cursor-pointer
          hover:bg-accent/20 hover:border-accent/40
          transition-all duration-150 select-none
          align-baseline leading-normal whitespace-nowrap"
        onClick={handleClick}
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
      >
        <span className="text-[10px]">{icon}</span>
        <span className="max-w-[180px] truncate">{label}</span>
      </span>

      {/* Tooltip — fixed position to escape overflow clipping */}
      {tooltip && (
        <span
          className="fixed px-2 py-1 rounded-md text-[10px] font-normal
            bg-bg-card border border-border-subtle shadow-lg
            text-text-secondary whitespace-nowrap z-[9999]
            pointer-events-none animate-fade-in"
          style={{
            left: tooltip.x,
            top: tooltip.y - 6,
            transform: 'translate(-50%, -100%)',
          }}
        >
          {fullPath}
        </span>
      )}
    </NodeViewWrapper>
  );
}
