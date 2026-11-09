import { describe, it, expect } from 'vitest';
import {
  classifyPathToken, computeRevealExpansions, findNodeByPath, normalizePath,
  normalizeTreePaths, reconcilePathToRoot, resolvePathToken, setHomeDir, splitPathAndLine,
} from '../fileReveal';
import type { FileNode } from '../../lib/tauri-bridge';

describe('normalizePath', () => {
  it('去掉末尾斜杠（含多个）', () => {
    expect(normalizePath('/a/b/')).toBe('/a/b');
    expect(normalizePath('/a/b///')).toBe('/a/b');
  });
  it('没有末尾斜杠时原样返回', () => {
    expect(normalizePath('/a/b')).toBe('/a/b');
  });
  it('根斜杠保留', () => {
    expect(normalizePath('/')).toBe('/');
  });
  it('反斜杠统一成正斜杠', () => {
    expect(normalizePath('D:\\ccSwitch\\src\\a.ts')).toBe('D:/ccSwitch/src/a.ts');
  });
  it('盘符根保留末尾斜杠', () => {
    expect(normalizePath('D:\\')).toBe('D:/');
  });
  it('折叠中间重复斜杠', () => {
    expect(normalizePath('D:/proj//src///a.ts')).toBe('D:/proj/src/a.ts');
  });
  it('尾反斜杠拼出的混合分隔符也归一到同一形态', () => {
    expect(normalizePath('D:\\proj\\/src/a.ts')).toBe('D:/proj/src/a.ts');
  });
  it('UNC 路径开头的双斜杠保留', () => {
    expect(normalizePath('\\\\server\\share\\a.ts')).toBe('//server/share/a.ts');
  });
});

describe('normalizeTreePaths（树节点路径归一）', () => {
  it('递归把 node.path 转成正斜杠，其余字段不动', () => {
    const tree: FileNode[] = [
      { name: 'src', path: 'D:\\ccSwitch\\src', is_dir: true, children: [
        { name: 'a.ts', path: 'D:\\ccSwitch\\src\\a.ts', is_dir: false, children: null },
      ] },
    ];
    expect(normalizeTreePaths(tree)).toEqual([
      { name: 'src', path: 'D:/ccSwitch/src', is_dir: true, children: [
        { name: 'a.ts', path: 'D:/ccSwitch/src/a.ts', is_dir: false, children: null },
      ] },
    ]);
  });
  it('归一后能被 findNodeByPath 按正斜杠绝对路径命中', () => {
    const tree = normalizeTreePaths([
      { name: 'src', path: 'D:\\ccSwitch\\src', is_dir: true, children: [
        { name: 'a.ts', path: 'D:\\ccSwitch\\src\\a.ts', is_dir: false, children: null },
      ] },
    ]);
    expect(findNodeByPath(tree, 'D:/ccSwitch/src/a.ts')?.name).toBe('a.ts');
  });
  it('路径本来就规范时返回原对象', () => {
    const node: FileNode = { name: 'a.md', path: '/root/a.md', is_dir: false, children: null };
    expect(normalizeTreePaths([node])[0]).toBe(node);
  });
});

// 聊天里点一个路径引用块 → 要在右侧文件树里展开到它。
// computeRevealExpansions 算出「为此需要展开哪些文件夹」，再喂给 fileStore。
describe('computeRevealExpansions（定位时要展开哪些祖先文件夹）', () => {
  const root = '/root';

  it('深层文件：展开各级父目录，不含文件自身', () => {
    expect(computeRevealExpansions('/root/a/b/c.md', root, false))
      .toEqual(['/root/a', '/root/a/b']);
  });

  it('深层文件夹：展开各级父目录 + 文件夹自身', () => {
    expect(computeRevealExpansions('/root/a/b/c', root, true))
      .toEqual(['/root/a', '/root/a/b', '/root/a/b/c']);
  });

  it('文件夹路径带末尾斜杠也能正确处理', () => {
    expect(computeRevealExpansions('/root/a/b/c/', root, true))
      .toEqual(['/root/a', '/root/a/b', '/root/a/b/c']);
  });

  it('中文 + 数字前缀路径（真实工作间形态）', () => {
    expect(computeRevealExpansions('/root/01_Her/02_创业系统/_增长线/', root, true))
      .toEqual(['/root/01_Her', '/root/01_Her/02_创业系统', '/root/01_Her/02_创业系统/_增长线']);
  });

  it('顶层文件：没有需要展开的祖先', () => {
    expect(computeRevealExpansions('/root/x.md', root, false)).toEqual([]);
  });

  it('顶层文件夹：只展开它自身', () => {
    expect(computeRevealExpansions('/root/x', root, true)).toEqual(['/root/x']);
  });

  it('目标就是根：返回空', () => {
    expect(computeRevealExpansions('/root', root, false)).toEqual([]);
  });

  it('目标不在根之下：返回空（无法定位）', () => {
    expect(computeRevealExpansions('/other/a', root, true)).toEqual([]);
  });

  it('root 带末尾斜杠也兼容', () => {
    expect(computeRevealExpansions('/root/a/b', '/root/', true))
      .toEqual(['/root/a', '/root/a/b']);
  });

  it('前缀相近但不是真子路径（/root2 不算 /root 的下级）', () => {
    expect(computeRevealExpansions('/root2/a', root, true)).toEqual([]);
  });
});

describe('findNodeByPath（按绝对路径在树里找节点）', () => {
  const tree: FileNode[] = [
    { name: '01_Her', path: '/root/01_Her', is_dir: true, children: [
      { name: '02_创业系统', path: '/root/01_Her/02_创业系统', is_dir: true, children: [
        { name: '_增长线', path: '/root/01_Her/02_创业系统/_增长线', is_dir: true, children: [] },
        { name: 'a.md', path: '/root/01_Her/02_创业系统/a.md', is_dir: false, children: null },
      ] },
    ] },
    { name: 'readme.md', path: '/root/readme.md', is_dir: false, children: null },
  ];

  it('找到深层文件夹', () => {
    expect(findNodeByPath(tree, '/root/01_Her/02_创业系统/_增长线')?.is_dir).toBe(true);
  });
  it('找到深层文件', () => {
    expect(findNodeByPath(tree, '/root/01_Her/02_创业系统/a.md')?.is_dir).toBe(false);
  });
  it('目标带末尾斜杠也能匹配', () => {
    expect(findNodeByPath(tree, '/root/01_Her/02_创业系统/_增长线/')?.name).toBe('_增长线');
  });
  it('顶层文件', () => {
    expect(findNodeByPath(tree, '/root/readme.md')?.is_dir).toBe(false);
  });
  it('找不到返回 null', () => {
    expect(findNodeByPath(tree, '/root/不存在/x')).toBe(null);
  });
});

// 聊天里反引号包的文本，要判断成 文件 / 文件夹 / 都不是。
// 关键诉求：支持中文路径（旧规则只认英文前缀路径，中文一律漏判）。
describe('classifyPathToken（判断反引号内是不是路径）', () => {
  it('中文相对路径文件 → file', () => {
    expect(classifyPathToken('01_Her/02_创业系统/_增长线/6.7看板.html')).toBe('file');
  });
  it('中文裸文件名 → file', () => {
    expect(classifyPathToken('数据05-31.html')).toBe('file');
  });
  it('英文裸文件名 → file', () => {
    expect(classifyPathToken('package.json')).toBe('file');
  });
  it('中文文件夹（末尾斜杠）→ folder', () => {
    expect(classifyPathToken('01_Her/02_创业系统/_增长线/')).toBe('folder');
  });
  it('普通行内代码 useState → null', () => {
    expect(classifyPathToken('useState')).toBe(null);
  });
  it('Math.PI 不是已知扩展名 → null', () => {
    expect(classifyPathToken('Math.PI')).toBe(null);
  });
  it('含空格的全路径 → null（避免误判句子/全路径）', () => {
    expect(classifyPathToken('/Users/x/Mobile Documents/a/6.7看板.html')).toBe(null);
  });
  it('单字符 → null', () => {
    expect(classifyPathToken('a')).toBe(null);
  });
  // 前缀检测（#110）：有明确路径前缀时，扩展名可选
  it('项目目录前缀 + 无扩展名 → file', () => {
    expect(classifyPathToken('src/build')).toBe('file');
  });
  it('相对前缀 ./ + 无扩展名 → file', () => {
    expect(classifyPathToken('./scripts/deploy')).toBe('file');
  });
  it('隐藏目录前缀 .claude/ → file', () => {
    expect(classifyPathToken('.claude/settings.local')).toBe('file');
  });
  it('隐藏目录自身（末尾斜杠）→ folder', () => {
    expect(classifyPathToken('.github/')).toBe('folder');
  });
  it('盘符前缀 + 无扩展名 → file', () => {
    expect(classifyPathToken('C:\\Users\\x\\bin')).toBe('file');
  });
  it('绝对路径 + 无扩展名 → file', () => {
    expect(classifyPathToken('/usr/local/bin/claude')).toBe('file');
  });
});

describe('resolvePathToken（相对路径拼成绝对路径）', () => {
  const base = '/root';
  it('相对路径拼到 base 下', () => {
    expect(resolvePathToken('01_Her/a.md', base)).toBe('/root/01_Her/a.md');
  });
  it('文件夹末尾斜杠被去掉', () => {
    expect(resolvePathToken('01_Her/_增长线/', base)).toBe('/root/01_Her/_增长线');
  });
  it('绝对路径原样（只去末尾斜杠）', () => {
    expect(resolvePathToken('/abs/path/a.md', base)).toBe('/abs/path/a.md');
  });
  it('base 带末尾斜杠也兼容', () => {
    expect(resolvePathToken('a.md', '/root/')).toBe('/root/a.md');
  });
  it('base 带尾反斜杠也兼容（Windows 工作目录常见）', () => {
    expect(resolvePathToken('a.md', 'D:\\proj\\')).toBe('D:/proj/a.md');
  });
});

describe('resolvePathToken 展开 ~', () => {
  it('~/x 展开到家目录', () => {
    setHomeDir('C:\\Users\\me\\');
    expect(resolvePathToken('~/.claude.json', '/project')).toBe('C:/Users/me/.claude.json');
  });
  it('家目录未加载时原样返回', () => {
    setHomeDir('');
    expect(resolvePathToken('~/a.md', '/project')).toBe('~/a.md');
  });
});

describe('splitPathAndLine（路径尾部的行号）', () => {
  it('单行号', () => {
    expect(splitPathAndLine('src/a.ts:12')).toEqual({ path: 'src/a.ts', line: 12 });
  });
  it('行号区间取起始行', () => {
    expect(splitPathAndLine('lib.rs:40-52')).toEqual({ path: 'lib.rs', line: 40 });
  });
  it('没有行号', () => {
    expect(splitPathAndLine('src/a.ts')).toEqual({ path: 'src/a.ts', line: null });
  });
  it('带端口的 URL 即使拆出数字，也不会被当成文件路径', () => {
    const parsed = splitPathAndLine('http://x:8080');
    expect(classifyPathToken(parsed.path)).toBe(null);
  });
});

// AI 在聊天里给的全路径，iCloud 前缀段常写得和真实文件系统不一致
// （com~apple~CloudDocs ↔ com-apple-CloudDocs / 整段缺失）→ 定位前先对齐回真实 root。
describe('reconcilePathToRoot（前缀不准的绝对路径对齐回真实 root）', () => {
  const root = '/Users/x/Library/Mobile Documents/com~apple~CloudDocs/2026工作间';

  it('iCloud 段缺失的全路径 → 对齐回真实 root', () => {
    expect(reconcilePathToRoot('/Users/x/Library/Mobile Documents/2026工作间/01_Her/6.7看板.html', root))
      .toBe('/Users/x/Library/Mobile Documents/com~apple~CloudDocs/2026工作间/01_Her/6.7看板.html');
  });
  it('iCloud 段被写成连字符 → 对齐回真实 root', () => {
    expect(reconcilePathToRoot('/Users/x/Library/Mobile Documents/com-apple-CloudDocs/2026工作间/01_Her/6.7看板.html', root))
      .toBe('/Users/x/Library/Mobile Documents/com~apple~CloudDocs/2026工作间/01_Her/6.7看板.html');
  });
  it('已在真实 root 下 → 原样返回', () => {
    const p = `${root}/01_Her/6.7看板.html`;
    expect(reconcilePathToRoot(p, root)).toBe(p);
  });
  it('找不到工作区名锚点 → 原样返回', () => {
    expect(reconcilePathToRoot('/totally/different/a.html', root)).toBe('/totally/different/a.html');
  });
  it('末尾斜杠先规范化', () => {
    expect(reconcilePathToRoot('/Users/x/Library/Mobile Documents/2026工作间/01_Her/', root))
      .toBe(`${root}/01_Her`);
  });
});
