import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { FileNode } from '../../lib/tauri-bridge';

// 只 mock 桥接层：readFileTree 可控；fileReveal 纯函数用真实现（链路更接近实跑）
vi.mock('../../lib/tauri-bridge', () => ({
  bridge: {
    readFileTree: vi.fn(),
  },
}));

import { bridge } from '../../lib/tauri-bridge';
import { useFileStore } from '../fileStore';

const ROOT = '/root/2026工作间';
const DEEP_DIR = `${ROOT}/03_教学/08_演讲/618 43 talks`;
const NEW_FILE = `${DEEP_DIR}/00_总控PRD.md`;

/** 不含新文件的树快照（loadTree 时刻的旧状态） */
const staleTree = (): FileNode[] => [
  { name: '03_教学', path: `${ROOT}/03_教学`, is_dir: true, children: [
    { name: '08_演讲', path: `${ROOT}/03_教学/08_演讲`, is_dir: true, children: [
      { name: '618 43 talks', path: DEEP_DIR, is_dir: true, children: [
        { name: '01_叙事逻辑.md', path: `${DEEP_DIR}/01_叙事逻辑.md`, is_dir: false, children: null },
      ] },
    ] },
  ] },
];

/** 磁盘上的最新树：AI 刚写出的 00_总控PRD.md 已存在 */
const freshTree = (): FileNode[] => {
  const t = staleTree();
  t[0].children![0].children![0].children!.push(
    { name: '00_总控PRD.md', path: NEW_FILE, is_dir: false, children: null },
  );
  return t;
};

beforeEach(() => {
  vi.mocked(bridge.readFileTree).mockReset();
  useFileStore.setState({
    rootPath: ROOT,
    tree: staleTree(),
    expandedFolders: new Set<string>(),
    revealTarget: null,
  });
});

// 复现 2026-06-10 现场：流式对话中 AI 刚交付 00_总控PRD.md，胶囊即时出现，
// 但树还是旧快照（watcher/工具完成的刷新是异步追赶的）→ 点击必须自己把树对齐。
describe('revealPath：树快照落后于磁盘时主动刷新再定位', () => {
  it('新文件不在树里 → 自动 refreshTree → 兜底命中真实节点并展开三层祖先', async () => {
    vi.mocked(bridge.readFileTree).mockResolvedValue(freshTree());

    // 胶囊给的是裸文件名，resolve 后挂在根下（实际文件在四层深处）
    await useFileStore.getState().revealPath(`${ROOT}/00_总控PRD.md`);

    expect(bridge.readFileTree).toHaveBeenCalledTimes(1); // 发生了主动刷新
    const s = useFileStore.getState();
    expect(s.revealTarget).toBe(NEW_FILE);
    expect(s.expandedFolders.has(`${ROOT}/03_教学`)).toBe(true);
    expect(s.expandedFolders.has(`${ROOT}/03_教学/08_演讲`)).toBe(true);
    expect(s.expandedFolders.has(DEEP_DIR)).toBe(true);
  });

  it('文件已在树里 → 不触发多余的刷新', async () => {
    await useFileStore.getState().revealPath(`${DEEP_DIR}/01_叙事逻辑.md`);

    expect(bridge.readFileTree).not.toHaveBeenCalled();
    expect(useFileStore.getState().revealTarget).toBe(`${DEEP_DIR}/01_叙事逻辑.md`);
  });

  it('刷新后磁盘上也没有 → 维持原回退行为（revealTarget 用 reconciled 值，不误定位）', async () => {
    vi.mocked(bridge.readFileTree).mockResolvedValue(staleTree());

    await useFileStore.getState().revealPath(`${ROOT}/不存在.md`);

    expect(bridge.readFileTree).toHaveBeenCalledTimes(1);
    expect(useFileStore.getState().revealTarget).toBe(`${ROOT}/不存在.md`);
  });
});
