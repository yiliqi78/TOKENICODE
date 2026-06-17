import { FileNode } from '../lib/tauri-bridge';

/** 已知代码 / 配置 / 文档 / 图片文件扩展名——聊天里的「文件路径」识别共用这一份。 */
export const KNOWN_FILE_EXTENSIONS = new Set([
  'md', 'mdx', 'ts', 'tsx', 'js', 'jsx', 'mjs', 'cjs', 'json', 'jsonl',
  'toml', 'yaml', 'yml', 'py', 'pyi', 'rs', 'go', 'html', 'htm', 'css',
  'scss', 'sass', 'less', 'vue', 'svelte', 'sh', 'bash', 'zsh', 'fish',
  'env', 'conf', 'cfg', 'ini', 'xml', 'sql', 'graphql', 'gql', 'proto',
  'lock', 'log', 'txt', 'csv', 'rb', 'php', 'java', 'kt', 'swift', 'c',
  'cpp', 'h', 'hpp', 'cs', 'r', 'lua', 'zig', 'ex', 'exs', 'erl', 'ml',
  'mli', 'tf', 'hcl', 'dockerfile', 'makefile', 'png', 'jpg', 'jpeg',
  'gif', 'svg', 'webp', 'ico', 'wasm', 'map', 'pdf', 'doc', 'docx',
]);

/** 明确的路径前缀：绝对/相对/盘符/隐藏目录（.claude/ .github/）/常见项目目录。
 *  命中前缀即视为路径，扩展名可选（来自 #110 的前缀检测）。 */
const PATH_PREFIX_RE = /^(?:\/|\.\/|\.\.\/|[a-zA-Z]:[/\\]|\.[a-zA-Z][\w.-]*\/|src\/|lib\/|components\/|stores\/|hooks\/|utils\/|tests\/|__tests__\/)/;

/**
 * 判断一段反引号内的文本是不是路径，是文件还是文件夹。
 *
 * 规则放宽以支持中文路径（旧规则只认英文前缀路径，中文一律漏掉）：
 * - 无空格 + 明确路径前缀 → 'file' / 'folder'（扩展名可选，如 src/build、./scripts/deploy）
 * - 无空格 + 末尾是已知扩展名 → 'file'（含中文路径 / 相对路径 / 裸文件名）
 * - 无空格 + 以 / 结尾 → 'folder'
 * - 其余（含空格的全路径、普通行内代码如 useState / Math.PI）→ null
 *
 * 「无空格」是关键护栏：避免把普通句子或带空格的全路径误判成可点路径。
 */
export function classifyPathToken(text: string): 'file' | 'folder' | null {
  const trimmed = text.trim();
  if (trimmed.length <= 1 || /\s/.test(trimmed)) return null;
  if (PATH_PREFIX_RE.test(trimmed)) {
    return trimmed.endsWith('/') ? 'folder' : 'file';
  }
  const ext = trimmed.split('.').pop()?.toLowerCase() ?? '';
  if (KNOWN_FILE_EXTENSIONS.has(ext)) return 'file';
  if (trimmed.endsWith('/')) return 'folder';
  return null;
}

/** 把路径文本解析成绝对路径（相对路径拼到 base 下），并去掉末尾斜杠，便于和文件树节点匹配。 */
export function resolvePathToken(text: string, base: string): string {
  const cleaned = text.trim().replace(/\/+$/, '');
  if (cleaned.startsWith('/') || /^[a-zA-Z]:[/\\]/.test(cleaned)) return cleaned;
  return base ? `${base.replace(/\/$/, '')}/${cleaned}` : cleaned;
}

/** 去掉路径末尾的斜杠（一个或多个）；根 '/' 本身保留。 */
export function normalizePath(p: string): string {
  if (p === '/') return p;
  return p.replace(/\/+$/, '');
}

/**
 * 算出「要让 targetPath 在文件树里可见、需要展开哪些文件夹」。
 *
 * 纯函数：返回 targetPath 在 rootPath 之下的所有祖先目录；若 targetIsDir，
 * 连 targetPath 自身也算进去（点文件夹＝把它打开）。抽成纯函数是为了能在
 * node 环境直接单测——中文 / 空格 / 末尾斜杠 / 不在根目录下，这些边界都在这里收口。
 *
 * - targetPath 不在 rootPath 之下 → 空数组（无法定位）。
 * - targetPath 就是 rootPath → 空数组（根本身不需要展开）。
 * - 顶层文件（直接在 root 下）→ 空数组（没有需要展开的祖先）。
 * - 始终返回新数组，不改动入参。
 */
export function computeRevealExpansions(
  targetPath: string,
  rootPath: string,
  targetIsDir: boolean,
): string[] {
  const target = normalizePath(targetPath);
  const root = normalizePath(rootPath);
  if (!root || !target) return [];
  if (target === root) return [];
  if (!target.startsWith(root + '/')) return [];

  const rel = target.slice(root.length + 1);
  const parts = rel.split('/').filter(Boolean);
  const result: string[] = [];
  let cur = root;
  // 祖先目录＝除最后一段外的每一级
  for (let i = 0; i < parts.length - 1; i++) {
    cur = `${cur}/${parts[i]}`;
    result.push(cur);
  }
  // 目标本身是文件夹 → 一并展开（"打开"它）
  if (targetIsDir) result.push(target);
  return result;
}

/**
 * 在文件树里按绝对路径查找节点（用来判断目标是文件还是文件夹）。
 * 树只加载到有限深度，找不到时返回 null（调用方回退到「末尾斜杠」判断）。
 */
export function findNodeByPath(tree: FileNode[], path: string): FileNode | null {
  const target = normalizePath(path);
  for (const node of tree) {
    const nodePath = normalizePath(node.path);
    if (nodePath === target) return node;
    if (node.is_dir && node.children && target.startsWith(nodePath + '/')) {
      const found = findNodeByPath(node.children, target);
      if (found) return found;
    }
  }
  return null;
}

/**
 * 兜底：按「路径后缀」在已加载的树里找最匹配的节点。
 *
 * findNodeByPath 要求绝对路径精确相等，但 AI 在聊天里给的路径极少是「从工作区
 * 根算起的完整相对路径」——更多是裸文件名（brief_2026-06-06.md）或半截相对路径。
 * 这类 token 经 resolvePathToken 拼成的绝对路径（当成就在根下）在树里根本不存在，
 * 精确匹配必然 null → 点了胶囊不展开不高亮。这是该功能「过半点击没反应」的主因。
 *
 * 策略：取 targetPath 的基名（最后一段），收集树里所有同名节点；
 * - 唯一 → 直接用；
 * - 多个同名 → 按「与 targetPath 共享的结尾路径段数」打分取最高（让
 *   06_DEV/_本周.md 命中 06_DEV 下那个而非别处同名文件），并列再取路径最短者
 *   （更靠近根，结果稳定可预测）。
 * 没有同名节点 → null（调用方维持原行为，不误定位）。
 *
 * 纯函数：遍历入参树、不改动它，便于在 node 环境直接单测。
 */
export function findNodeBySuffix(tree: FileNode[], targetPath: string): FileNode | null {
  const targetSegs = normalizePath(targetPath).split('/').filter(Boolean);
  const baseName = targetSegs[targetSegs.length - 1];
  if (!baseName) return null;

  const candidates: FileNode[] = [];
  const walk = (nodes: FileNode[]) => {
    for (const n of nodes) {
      const segs = normalizePath(n.path).split('/').filter(Boolean);
      if (segs[segs.length - 1] === baseName) candidates.push(n);
      if (n.children) walk(n.children);
    }
  };
  walk(tree);

  if (candidates.length === 0) return null;
  if (candidates.length === 1) return candidates[0];

  // 与 target 从末尾往前共享多少段，段数越多越可能是用户指的那个
  const sharedTail = (p: string): number => {
    const segs = normalizePath(p).split('/').filter(Boolean);
    let i = 0;
    while (
      i < segs.length &&
      i < targetSegs.length &&
      segs[segs.length - 1 - i] === targetSegs[targetSegs.length - 1 - i]
    ) i++;
    return i;
  };

  return candidates.slice().sort((a, b) => {
    const byTail = sharedTail(b.path) - sharedTail(a.path);
    if (byTail !== 0) return byTail;
    return normalizePath(a.path).length - normalizePath(b.path).length;
  })[0];
}

/**
 * 容错：把前缀可能不准的绝对路径«对齐»回真实 rootPath 下。
 *
 * AI 在聊天里给的绝对全路径，前缀常和真实文件系统不一致——iCloud 的
 * `com~apple~CloudDocs` 会被写成 `com-apple-CloudDocs`、甚至整段缺失。
 * 这类路径直接拿去和文件树匹配会失败（点了不展开 / 不高亮）。
 *
 * 策略：若 target 不在 root 之下，就用 root 的最后一段（工作区名）当锚点，
 * 在 target 里找到它、截取其后的相对部分，拼回真实 root。对不上则原样返回。
 * 相对路径、已在 root 下的绝对路径都不受影响。
 */
export function reconcilePathToRoot(target: string, root: string): string {
  const t = normalizePath(target);
  const r = normalizePath(root);
  if (!r || t === r || t.startsWith(r + '/')) return t;
  const rootName = r.split('/').pop() || '';
  if (!rootName) return t;
  const anchor = t.indexOf(`/${rootName}/`);
  if (anchor === -1) return t;
  return `${r}/${t.slice(anchor + rootName.length + 2)}`;
}
