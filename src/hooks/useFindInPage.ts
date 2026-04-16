import { useState, useCallback, useEffect, useRef } from 'react';

/**
 * Lightweight Cmd+F find-in-page for chat panels.
 * Uses TreeWalker to find text nodes, wraps matches in <mark>, and scrolls to current match.
 */
export function useFindInPage(containerRef: React.RefObject<HTMLDivElement | null>) {
  const [isOpen, setIsOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [matchIndex, setMatchIndex] = useState(0);
  const [matchCount, setMatchCount] = useState(0);
  const marksRef = useRef<HTMLElement[]>([]);

  // Clear all highlights
  const clearMarks = useCallback(() => {
    const container = containerRef.current;
    if (!container) return;
    const marks = container.querySelectorAll('mark[data-find]');
    marks.forEach((mark) => {
      const parent = mark.parentNode;
      if (parent) {
        parent.replaceChild(document.createTextNode(mark.textContent || ''), mark);
        parent.normalize(); // merge adjacent text nodes
      }
    });
    marksRef.current = [];
    setMatchCount(0);
    setMatchIndex(0);
  }, [containerRef]);

  // Highlight all matches
  const highlight = useCallback((searchText: string) => {
    clearMarks();
    const container = containerRef.current;
    if (!container || !searchText) return;

    const lower = searchText.toLowerCase();
    const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT, {
      acceptNode: (node) => {
        // Skip nodes inside input/textarea/contenteditable
        const el = node.parentElement;
        if (!el) return NodeFilter.FILTER_REJECT;
        if (el.tagName === 'MARK' && el.hasAttribute('data-find')) return NodeFilter.FILTER_REJECT;
        if (el.closest('input, textarea, [contenteditable="true"], .tiptap')) return NodeFilter.FILTER_REJECT;
        return NodeFilter.FILTER_ACCEPT;
      },
    });

    const hits: HTMLElement[] = [];
    const nodesToProcess: { node: Text; indices: number[] }[] = [];

    let textNode: Text | null;
    while ((textNode = walker.nextNode() as Text | null)) {
      const text = textNode.textContent || '';
      const textLower = text.toLowerCase();
      const indices: number[] = [];
      let pos = 0;
      while ((pos = textLower.indexOf(lower, pos)) !== -1) {
        indices.push(pos);
        pos += lower.length;
      }
      if (indices.length > 0) {
        nodesToProcess.push({ node: textNode, indices });
      }
    }

    // Process in reverse to avoid invalidating earlier nodes
    for (const { node, indices } of nodesToProcess) {
      const text = node.textContent || '';
      const parent = node.parentNode;
      if (!parent) continue;
      const frag = document.createDocumentFragment();
      let lastEnd = 0;
      for (const idx of indices) {
        if (idx > lastEnd) {
          frag.appendChild(document.createTextNode(text.slice(lastEnd, idx)));
        }
        const mark = document.createElement('mark');
        mark.setAttribute('data-find', '');
        mark.style.cssText = 'background: rgba(255, 200, 0, 0.45); color: inherit; border-radius: 2px; padding: 0 1px;';
        mark.textContent = text.slice(idx, idx + lower.length);
        frag.appendChild(mark);
        hits.push(mark);
        lastEnd = idx + lower.length;
      }
      if (lastEnd < text.length) {
        frag.appendChild(document.createTextNode(text.slice(lastEnd)));
      }
      parent.replaceChild(frag, node);
    }

    marksRef.current = hits;
    setMatchCount(hits.length);
    if (hits.length > 0) {
      setMatchIndex(0);
      hits[0].style.background = 'rgba(255, 140, 0, 0.7)';
      hits[0].scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }, [containerRef, clearMarks]);

  // Navigate matches
  const goTo = useCallback((delta: number) => {
    const marks = marksRef.current;
    if (marks.length === 0) return;
    // Reset current
    marks[matchIndex].style.background = 'rgba(255, 200, 0, 0.45)';
    const next = (matchIndex + delta + marks.length) % marks.length;
    setMatchIndex(next);
    marks[next].style.background = 'rgba(255, 140, 0, 0.7)';
    marks[next].scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, [matchIndex]);

  const next = useCallback(() => goTo(1), [goTo]);
  const prev = useCallback(() => goTo(-1), [goTo]);

  const close = useCallback(() => {
    setIsOpen(false);
    setQuery('');
    clearMarks();
  }, [clearMarks]);

  const open = useCallback(() => {
    setIsOpen(true);
  }, []);

  // Cmd+F / Ctrl+F handler
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'f') {
        e.preventDefault();
        e.stopPropagation();
        if (isOpen) {
          close();
        } else {
          open();
        }
      }
      if (e.key === 'Escape' && isOpen) {
        e.preventDefault();
        close();
      }
    };
    window.addEventListener('keydown', handler, true); // capture phase
    return () => window.removeEventListener('keydown', handler, true);
  }, [isOpen, open, close]);

  // Re-highlight when query changes
  useEffect(() => {
    if (isOpen && query) {
      highlight(query);
    } else if (!query) {
      clearMarks();
    }
  }, [query, isOpen, highlight, clearMarks]);

  return { isOpen, query, setQuery, matchIndex, matchCount, next, prev, close };
}
