import { useEffect, useState, useCallback } from 'react';
import { create } from 'zustand';

// --- Toast micro-store ---

type ToastVariant = 'success' | 'error' | 'info';

interface ToastAction {
  label: string;
  onClick: () => void;
}

interface ToastItem {
  id: number;
  message: string;
  variant: ToastVariant;
  action?: ToastAction;
}

interface ToastStore {
  toasts: ToastItem[];
  add: (toast: Omit<ToastItem, 'id'>) => void;
  remove: (id: number) => void;
}

let nextId = 1;

const useToastStore = create<ToastStore>((set) => ({
  toasts: [],
  add: (toast) => set((s) => ({ toasts: [...s.toasts, { ...toast, id: nextId++ }] })),
  remove: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
}));

/** Show a toast notification. Call from anywhere — no React context needed. */
export function showToast(
  message: string,
  variant: ToastVariant = 'info',
  action?: ToastAction,
) {
  useToastStore.getState().add({ message, variant, action });
}

// --- Toast UI ---

const VARIANT_STYLES: Record<ToastVariant, string> = {
  success: 'bg-accent text-text-inverse border-transparent shadow-[0_14px_40px_var(--color-accent-glow)]',
  error: 'bg-red-500 text-white border-transparent shadow-[0_14px_40px_rgba(239,68,68,0.22)]',
  info: 'bg-accent text-text-inverse border-transparent shadow-[0_14px_40px_var(--color-accent-glow)]',
};

const VARIANT_ICONS: Record<ToastVariant, React.ReactNode> = {
  success: (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none"
      stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 8.5l2.5 2.5L12 5" />
    </svg>
  ),
  error: (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none"
      stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <circle cx="8" cy="8" r="6" />
      <path d="M8 5v4M8 11.5v.5" />
    </svg>
  ),
  info: (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none"
      stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <circle cx="8" cy="8" r="6" />
      <path d="M8 7v4M8 4.5v.5" />
    </svg>
  ),
};

function ToastItem({ toast, onDismiss }: { toast: ToastItem; onDismiss: () => void }) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    requestAnimationFrame(() => setVisible(true));
  }, []);

  const dismiss = useCallback(() => {
    setVisible(false);
    setTimeout(onDismiss, 200);
  }, [onDismiss]);

  useEffect(() => {
    const ms = toast.action ? 5000 : 3000;
    const timer = setTimeout(dismiss, ms);
    return () => clearTimeout(timer);
  }, [toast.action, dismiss]);

  return (
    <div
      className={`flex items-center justify-start gap-2.5 min-w-[180px]
        max-w-[min(520px,calc(100vw-48px))] px-4 py-2.5 rounded-xl
        border text-left text-xs font-semibold
        transition-all duration-200 ease-out
        ${VARIANT_STYLES[toast.variant]}
        ${visible ? 'opacity-100 translate-y-0' : 'opacity-0 -translate-y-2'}`}
    >
      <span className="flex-shrink-0">{VARIANT_ICONS[toast.variant]}</span>
      <span className="min-w-0 flex-1 text-left leading-5">{toast.message}</span>
      {toast.action && (
        <button
          onClick={() => { toast.action!.onClick(); dismiss(); }}
          className="ml-2 px-3.5 py-1.5 rounded-lg text-xs font-semibold
            bg-white/20 text-inherit hover:bg-white/30 shadow-sm transition-smooth"
        >
          {toast.action.label}
        </button>
      )}
    </div>
  );
}

/** Mount once in App.tsx — renders at top center below the title bar */
export function Toast() {
  const toasts = useToastStore((s) => s.toasts);
  const remove = useToastStore((s) => s.remove);

  if (toasts.length === 0) return null;

  return (
    <div className="fixed top-14 left-1/2 -translate-x-1/2 z-[9998]
      flex flex-col items-center gap-2 pointer-events-auto">
      {toasts.map((t) => (
        <ToastItem key={t.id} toast={t} onDismiss={() => remove(t.id)} />
      ))}
    </div>
  );
}
