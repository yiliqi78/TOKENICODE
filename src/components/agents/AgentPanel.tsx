import { useMemo, useState, useEffect } from 'react';
import { useAgentStore, AgentNode, AgentPhase } from '../../stores/agentStore';
import { useT } from '../../lib/i18n';

// --- Phase visual config ---

const phaseConfig: Record<AgentPhase, {
  color: string;
  pulseColor: string;
  pulse: boolean;
  labelKey: string;
}> = {
  spawning: {
    color: 'bg-text-tertiary',
    pulseColor: 'bg-text-tertiary/40',
    pulse: true,
    labelKey: 'agents.spawning',
  },
  thinking: {
    color: 'bg-amber-400',
    pulseColor: 'bg-amber-400/40',
    pulse: true,
    labelKey: 'agents.thinking',
  },
  writing: {
    color: 'bg-accent',
    pulseColor: 'bg-accent/40',
    pulse: true,
    labelKey: 'agents.writing',
  },
  tool: {
    color: 'bg-blue-400',
    pulseColor: 'bg-blue-400/40',
    pulse: true,
    labelKey: 'agents.runningTool',
  },
  completed: {
    color: 'bg-green-500',
    pulseColor: '',
    pulse: false,
    labelKey: 'agents.completed',
  },
  error: {
    color: 'bg-red-500',
    pulseColor: '',
    pulse: false,
    labelKey: 'agents.error',
  },
};

// --- Elapsed time display ---

function ElapsedTime({ startTime, endTime }: { startTime: number; endTime?: number }) {
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    if (endTime) return; // no need to tick if already finished
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [endTime]);

  const elapsed = Math.floor(((endTime || now) - startTime) / 1000);
  if (elapsed < 60) return <span>{elapsed}s</span>;
  const mins = Math.floor(elapsed / 60);
  const secs = elapsed % 60;
  return <span>{mins}m {secs}s</span>;
}

// --- Status dot ---

function StatusDot({ phase }: { phase: AgentPhase }) {
  const config = phaseConfig[phase];
  return (
    <span className="relative flex-shrink-0 w-2 h-2">
      {config.pulse && (
        <span className={`absolute inset-0 rounded-full animate-ping ${config.pulseColor}`} />
      )}
      <span className={`relative block w-2 h-2 rounded-full ${config.color}`} />
    </span>
  );
}

// --- Agent tree node ---

function AgentTreeNode({
  agent,
  children,
  depth,
}: {
  agent: AgentNode;
  children: AgentNode[];
  depth: number;
}) {
  const t = useT();
  const agents = useAgentStore((s) => s.agents);
  const config = phaseConfig[agent.phase];

  // Get children of this agent
  const childAgents = useMemo(
    () => children.filter((a) => a.parentId === agent.id),
    [children, agent.id],
  );

  // All agents for recursive rendering
  const allAgents = useMemo(() => Array.from(agents.values()), [agents]);

  const isFinished = agent.phase === 'completed' || agent.phase === 'error';
  const label = agent.isMain ? t('agents.main') : agent.description;

  // Phase status text
  const phaseText = agent.phase === 'tool' && agent.currentTool
    ? `${t(config.labelKey)}: ${agent.currentTool}`
    : t(config.labelKey);

  return (
    <div style={{ paddingLeft: `${depth * 16}px` }}>
      {/* Node content */}
      <div className={`group flex flex-col gap-0.5 py-1.5 px-2 rounded-lg
        transition-smooth
        ${isFinished ? 'opacity-70' : ''}
        hover:bg-bg-secondary/50`}>
        {/* Top line: dot + title + elapsed */}
        <div className="flex items-center gap-2 min-w-0">
          <StatusDot phase={agent.phase} />
          <span className={`text-xs font-medium truncate flex-1 min-w-0
            ${isFinished ? 'text-text-muted' : 'text-text-primary'}`}>
            {label}
          </span>
          <span className="text-[10px] text-text-tertiary font-mono flex-shrink-0 tabular-nums">
            <ElapsedTime startTime={agent.startTime} endTime={agent.endTime} />
          </span>
        </div>
        {/* Bottom line: phase text */}
        <div className="flex items-center gap-2 pl-4">
          <span className={`text-[10px] truncate
            ${agent.phase === 'error' ? 'text-red-400' : 'text-text-tertiary'}`}>
            {phaseText}
          </span>
        </div>
      </div>

      {/* Children */}
      {childAgents.length > 0 && (
        <div className="relative">
          {/* Vertical connecting line */}
          <div className="absolute left-[11px] top-0 bottom-2 w-px bg-border-subtle" />
          {childAgents.map((child) => (
            <AgentTreeNode
              key={child.id}
              agent={child}
              children={allAgents}
              depth={depth + 1}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// --- Main panel ---

export function AgentPanel() {
  const t = useT();
  const agents = useAgentStore((s) => s.agents);

  const agentList = useMemo(() => Array.from(agents.values()), [agents]);
  const mainAgent = useMemo(() => agentList.find((a) => a.isMain), [agentList]);
  const activeCount = useMemo(
    () => agentList.filter((a) => a.phase !== 'completed' && a.phase !== 'error').length,
    [agentList],
  );
  const totalCount = agentList.length;

  // Empty state
  if (totalCount === 0) {
    return (
      <div className="flex flex-col h-full">
        <div className="flex items-center px-3 py-2 border-b border-border-subtle">
          <span className="text-[11px] font-semibold text-text-tertiary
            uppercase tracking-wider">{t('agents.title')}</span>
        </div>
        <div className="flex-1 flex flex-col items-center justify-center
          px-4 text-center">
          <svg width="32" height="32" viewBox="0 0 32 32" fill="none"
            stroke="currentColor" strokeWidth="1.2"
            className="text-text-tertiary/40 mb-3">
            <circle cx="16" cy="12" r="5" />
            <path d="M8 26a8 8 0 0116 0" />
            <circle cx="26" cy="10" r="3" />
            <path d="M22 20a5 5 0 0110 0" strokeDasharray="2 2" />
          </svg>
          <p className="text-xs text-text-tertiary leading-relaxed">
            {t('agents.empty')}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2
        border-b border-border-subtle">
        <div className="flex items-center gap-2">
          <span className="text-[11px] font-semibold text-text-tertiary
            uppercase tracking-wider">{t('agents.title')}</span>
          {activeCount > 0 && (
            <span className="text-[9px] px-1.5 py-0.5 rounded-full
              bg-accent/15 text-accent font-medium">
              {activeCount} {t('agents.active')}
            </span>
          )}
        </div>
        <span className="text-[10px] text-text-tertiary">
          {totalCount} {totalCount === 1 ? 'agent' : 'agents'}
        </span>
      </div>

      {/* Tree */}
      <div className="flex-1 overflow-y-auto py-1 px-1">
        {mainAgent && (
          <AgentTreeNode
            agent={mainAgent}
            children={agentList}
            depth={0}
          />
        )}
        {/* Orphan agents (parentId doesn't match any known agent) — fallback */}
        {agentList
          .filter((a) => !a.isMain && a.parentId && !agents.has(a.parentId))
          .map((orphan) => (
            <AgentTreeNode
              key={orphan.id}
              agent={orphan}
              children={agentList}
              depth={0}
            />
          ))}
      </div>
    </div>
  );
}
