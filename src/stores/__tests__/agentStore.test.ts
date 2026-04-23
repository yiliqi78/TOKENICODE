import { describe, it, expect, beforeEach } from 'vitest';
import { useAgentStore } from '../agentStore';

function resetAgents() {
  useAgentStore.setState({ agents: new Map(), agentCache: new Map() });
}

describe('agentStore', () => {
  beforeEach(() => {
    resetAgents();
  });

  describe('completeAll is idempotent', () => {
    it('running agents move to completed; second call is a no-op', () => {
      const s = useAgentStore.getState();
      s.upsertAgent({
        id: 'a1',
        parentId: null,
        description: 'main',
        phase: 'thinking',
        startTime: 1,
        isMain: true,
      });
      s.upsertAgent({
        id: 'a2',
        parentId: 'a1',
        description: 'sub',
        phase: 'writing',
        startTime: 2,
        isMain: false,
      });

      useAgentStore.getState().completeAll();
      const afterFirst = useAgentStore.getState().agents;
      expect(afterFirst.get('a1')?.phase).toBe('completed');
      expect(afterFirst.get('a2')?.phase).toBe('completed');
      const snapshotRef = afterFirst;

      useAgentStore.getState().completeAll();
      const afterSecond = useAgentStore.getState().agents;
      expect(afterSecond).toBe(snapshotRef);
    });

    it('does not re-stamp endTime on already-completed agents', () => {
      const s = useAgentStore.getState();
      s.upsertAgent({
        id: 'done',
        parentId: null,
        description: 'main',
        phase: 'completed',
        startTime: 1,
        endTime: 100,
        isMain: true,
      });
      useAgentStore.getState().completeAll();
      expect(useAgentStore.getState().agents.get('done')?.endTime).toBe(100);
    });

    it('error-phase agents are preserved', () => {
      const s = useAgentStore.getState();
      s.upsertAgent({
        id: 'err',
        parentId: null,
        description: 'main',
        phase: 'error',
        startTime: 1,
        isMain: true,
      });
      useAgentStore.getState().completeAll();
      expect(useAgentStore.getState().agents.get('err')?.phase).toBe('error');
    });
  });

  describe('clearCacheForTab (#B9)', () => {
    it('drops cache entry for the target tab without touching others', () => {
      const s = useAgentStore.getState();
      s.upsertAgent({
        id: 'a',
        parentId: null,
        description: 'A',
        phase: 'thinking',
        startTime: 1,
        isMain: true,
      });
      s.saveToCache('tab-a');
      s.clearAgents();
      s.upsertAgent({
        id: 'b',
        parentId: null,
        description: 'B',
        phase: 'thinking',
        startTime: 2,
        isMain: true,
      });
      s.saveToCache('tab-b');

      useAgentStore.getState().clearCacheForTab('tab-a');
      const cache = useAgentStore.getState().agentCache;
      expect(cache.has('tab-a')).toBe(false);
      expect(cache.has('tab-b')).toBe(true);
    });

    it('no-op when tab has no cache entry', () => {
      const before = useAgentStore.getState().agentCache;
      useAgentStore.getState().clearCacheForTab('never-existed');
      expect(useAgentStore.getState().agentCache).toBe(before);
    });

    it('fixes ghost-agent: delete+recreate with same tab id sees empty state', () => {
      const s = useAgentStore.getState();
      s.upsertAgent({
        id: 'ghost',
        parentId: null,
        description: 'stale',
        phase: 'thinking',
        startTime: 1,
        isMain: true,
      });
      s.saveToCache('tab-x');

      useAgentStore.getState().clearCacheForTab('tab-x');

      const restored = useAgentStore.getState().restoreFromCache('tab-x');
      expect(restored).toBe(false);
      expect(useAgentStore.getState().agents.size).toBe(0);
    });
  });

  describe('phase monotonicity', () => {
    it('does not regress an agent from writing back to thinking', () => {
      const s = useAgentStore.getState();
      s.upsertAgent({
        id: 'writer',
        parentId: null,
        description: 'main',
        phase: 'writing',
        startTime: 1,
        isMain: true,
      });

      useAgentStore.getState().updatePhase('writer', 'thinking');

      expect(useAgentStore.getState().agents.get('writer')?.phase).toBe('writing');
    });
  });
});
