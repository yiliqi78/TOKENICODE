import { useState, useCallback } from 'react';
import { type ChatMessage, useChatStore } from '../../stores/chatStore';
import { bridge } from '../../lib/tauri-bridge';
import { useT } from '../../lib/i18n';

interface Props {
  message: ChatMessage;
}

/**
 * QuestionCard — enhanced interactive question flow (AskUserQuestion).
 *
 * Enhancements over the inline version:
 * - Card wrapper with accent left border when active
 * - Visual progress bar (colored segments) replacing "1 / 3" text
 * - Better option styling with hover scale effect
 * - Answered questions shown with timeline connector
 */
export function QuestionCard({ message }: Props) {
  const t = useT();
  const questions = message.questions || [];
  const [currentIdx, setCurrentIdx] = useState(0);
  const [selectedMap, setSelectedMap] = useState<Record<number, Set<number>>>({});
  const [otherText, setOtherText] = useState<Record<number, string>>({});
  const [useOther, setUseOther] = useState<Record<number, boolean>>({});
  const [answeredMap, setAnsweredMap] = useState<Record<number, string>>({});

  const currentQ = questions[currentIdx];
  const isFullyResolved = message.resolved;

  const handleToggle = useCallback((optIdx: number, multi: boolean) => {
    if (isFullyResolved) return;
    const qIdx = currentIdx;
    setSelectedMap((prev) => {
      const current = prev[qIdx] || new Set<number>();
      const next = new Set(current);
      if (multi) {
        if (next.has(optIdx)) next.delete(optIdx);
        else next.add(optIdx);
      } else {
        next.clear();
        next.add(optIdx);
      }
      setUseOther((p) => ({ ...p, [qIdx]: false }));
      return { ...prev, [qIdx]: next };
    });
  }, [isFullyResolved, currentIdx]);

  const handleOtherToggle = useCallback(() => {
    if (isFullyResolved) return;
    const qIdx = currentIdx;
    setUseOther((prev) => {
      const next = !prev[qIdx];
      if (next) {
        setSelectedMap((p) => ({ ...p, [qIdx]: new Set<number>() }));
      }
      return { ...prev, [qIdx]: next };
    });
  }, [isFullyResolved, currentIdx]);

  const getCurrentAnswer = useCallback((): string => {
    const qIdx = currentIdx;
    const q = questions[qIdx];
    if (!q) return '';
    if (useOther[qIdx] && otherText[qIdx]?.trim()) {
      return otherText[qIdx].trim();
    }
    const selected = selectedMap[qIdx] || new Set<number>();
    return Array.from(selected)
      .map((i) => q.options[i]?.label)
      .filter(Boolean)
      .join(', ');
  }, [currentIdx, questions, selectedMap, useOther, otherText]);

  const hasCurrentSelection = useOther[currentIdx]
    ? !!otherText[currentIdx]?.trim()
    : (selectedMap[currentIdx]?.size || 0) > 0;

  const handleConfirm = useCallback(() => {
    if (isFullyResolved) return;
    const answerText = getCurrentAnswer();
    setAnsweredMap((prev) => ({ ...prev, [currentIdx]: answerText }));

    const isLast = currentIdx >= questions.length - 1;
    if (isLast) {
      const stdinId = useChatStore.getState().sessionMeta.stdinId;
      if (!stdinId) return;
      const answers: Record<string, string> = {};
      questions.forEach((q, qIdx) => {
        if (useOther[qIdx] && otherText[qIdx]?.trim()) {
          answers[String(qIdx)] = otherText[qIdx].trim();
        } else {
          const selected = selectedMap[qIdx] || new Set<number>();
          const labels = Array.from(selected)
            .map((i) => q.options[i]?.label)
            .filter(Boolean);
          if (labels.length > 0) {
            answers[String(qIdx)] = labels.join(', ');
          }
        }
      });
      bridge.sendStdin(stdinId, JSON.stringify({ answers }));
      useChatStore.getState().updateMessage(message.id, { resolved: true });
      useChatStore.setState({ partialText: '' });
    } else {
      setCurrentIdx(currentIdx + 1);
    }
  }, [isFullyResolved, currentIdx, questions, selectedMap, useOther, otherText, message.id, getCurrentAnswer]);

  const handleSkip = useCallback(() => {
    if (isFullyResolved) return;
    const stdinId = useChatStore.getState().sessionMeta.stdinId;
    if (!stdinId) return;
    bridge.sendStdin(stdinId, JSON.stringify({ answers: {} }));
    useChatStore.getState().updateMessage(message.id, { resolved: true });
    useChatStore.setState({ partialText: '' });
  }, [isFullyResolved, message.id]);

  return (
    <div className={`ml-11 animate-scale-in ${isFullyResolved ? 'opacity-80' : ''}`}>
      <div className={`rounded-xl border overflow-hidden transition-all duration-200
        ${isFullyResolved
          ? 'border-border-subtle bg-bg-secondary/20'
          : 'border-l-[3px] border-l-accent border-r border-t border-b border-r-accent/15 border-t-accent/15 border-b-accent/15 bg-gradient-to-r from-accent/[0.03] to-transparent'
        }`}>

        {/* Already answered questions — timeline view */}
        {Object.keys(answeredMap).length > 0 && (
          <div className="px-3 pt-2 pb-1 space-y-1">
            {Object.entries(answeredMap).map(([idxStr, answer]) => {
              const qIdx = Number(idxStr);
              const q = questions[qIdx];
              if (!q) return null;
              return (
                <div key={qIdx} className="flex items-start gap-2 py-1">
                  {/* Timeline connector dot */}
                  <div className="flex flex-col items-center flex-shrink-0 mt-0.5">
                    <div className="w-2 h-2 rounded-full bg-success" />
                    {qIdx < Object.keys(answeredMap).length - 1 && (
                      <div className="w-px h-3 bg-border-subtle mt-0.5" />
                    )}
                  </div>
                  <div className="text-xs text-text-muted min-w-0">
                    <span className="text-text-secondary">{q.question}</span>
                    {' \u2192 '}
                    <span className="text-text-primary font-medium">{answer}</span>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* Resolved state — show all answers */}
        {isFullyResolved && Object.keys(answeredMap).length === 0 && (
          <div className="flex items-center gap-1.5 px-3 py-2">
            <svg width="10" height="10" viewBox="0 0 12 12" fill="none"
              stroke="currentColor" strokeWidth="1.5" className="text-success">
              <path d="M2.5 6l2.5 2.5 4.5-4.5" />
            </svg>
            <span className="text-xs text-text-muted">{t('msg.responded')}</span>
          </div>
        )}

        {/* Current question — interactive */}
        {!isFullyResolved && currentQ && (
          <div className="px-3 py-3">
            {/* Visual progress bar for multi-question */}
            {questions.length > 1 && (
              <div className="flex items-center gap-1.5 mb-3">
                <div className="flex gap-0.5 flex-1">
                  {questions.map((_, i) => (
                    <div key={i} className={`h-1 rounded-full flex-1 transition-all duration-300
                      ${i < currentIdx
                        ? 'bg-success'
                        : i === currentIdx
                          ? 'bg-accent'
                          : 'bg-border-subtle'
                      }`} />
                  ))}
                </div>
                <span className="text-[10px] text-text-tertiary font-mono flex-shrink-0">
                  {currentIdx + 1}/{questions.length}
                </span>
              </div>
            )}

            {/* Question text with header badge */}
            <div className="flex items-start gap-2 mb-3">
              {currentQ.header && (
                <span className="flex-shrink-0 px-1.5 py-0.5 rounded
                  bg-accent/10 text-accent text-[10px] font-bold
                  uppercase tracking-wider mt-px">
                  {currentQ.header}
                </span>
              )}
              <span className="text-xs text-text-primary font-medium leading-relaxed">
                {currentQ.question}
              </span>
            </div>

            {/* Options */}
            <div className="flex flex-col gap-1.5 mb-3">
              {currentQ.options.map((opt, optIdx) => {
                const isSelected = selectedMap[currentIdx]?.has(optIdx) || false;
                return (
                  <button
                    key={optIdx}
                    onClick={() => handleToggle(optIdx, !!currentQ.multiSelect)}
                    className={`text-left px-3 py-2 rounded-lg text-xs
                      transition-all duration-150 border cursor-pointer
                      hover:scale-[1.01]
                      ${isSelected
                        ? 'border-accent bg-accent/10 text-accent shadow-sm'
                        : 'border-border-subtle text-text-secondary hover:border-accent/30 hover:bg-bg-secondary/50'
                      }`}
                  >
                    <span className="font-medium">{opt.label}</span>
                    {opt.description && (
                      <span className="text-text-tertiary ml-1.5">\u2014 {opt.description}</span>
                    )}
                  </button>
                );
              })}

              {/* Other option */}
              <button
                onClick={handleOtherToggle}
                className={`text-left px-3 py-2 rounded-lg text-xs
                  transition-all duration-150 border cursor-pointer
                  hover:scale-[1.01]
                  ${useOther[currentIdx]
                    ? 'border-accent bg-accent/10 text-accent'
                    : 'border-border-subtle text-text-tertiary hover:border-accent/30 hover:bg-bg-secondary/50'
                  }`}
              >
                {t('msg.questionOther')}
              </button>
            </div>

            {/* Other text input */}
            {useOther[currentIdx] && (
              <div className="mb-3">
                <input
                  type="text"
                  value={otherText[currentIdx] || ''}
                  onChange={(e) => setOtherText((p) => ({ ...p, [currentIdx]: e.target.value }))}
                  placeholder={t('msg.questionOtherPlaceholder')}
                  autoFocus
                  className="w-full max-w-xs px-3 py-1.5 rounded-lg text-xs
                    bg-transparent border border-border-subtle
                    focus:border-border-focus outline-none text-text-primary
                    placeholder:text-text-tertiary transition-smooth"
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault();
                      if (hasCurrentSelection) handleConfirm();
                    }
                  }}
                />
              </div>
            )}

            {/* Action buttons */}
            <div className="flex items-center gap-2">
              <button
                onClick={handleConfirm}
                disabled={!hasCurrentSelection}
                className="px-4 py-1.5 rounded-lg text-xs font-semibold
                  bg-accent text-text-inverse hover:bg-accent-hover
                  transition-smooth cursor-pointer shadow-sm
                  disabled:opacity-30 disabled:cursor-not-allowed"
              >
                {currentIdx >= questions.length - 1 ? t('msg.questionSubmit') : t('msg.questionNext')}
              </button>
              <button
                onClick={handleSkip}
                className="px-3 py-1.5 rounded-lg text-xs font-medium
                  text-text-tertiary hover:text-text-primary
                  hover:bg-bg-tertiary transition-smooth cursor-pointer"
              >
                {t('msg.questionSkip')}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
