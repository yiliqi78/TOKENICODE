# Phase 3: R5 Security — path_access + HTML/SVG + Markdown auth

## 方案文档

**完整修复方案**：`.trellis/workspace/suyuan/fix-plan-2026-04-21-v3.md`（§7 Phase 3, §3.1-§3.5）
**前置**：Phase 1 (`f5b4a7b`) + Phase 2 (`74dca2b`) 已 commit。

---

## 目标

1. Rust 后端 `path_access.rs`：多根白名单 + capability-based path grant
2. 所有文件命令 + skill 接口过 `validate()`
3. HTML 预览去 `allow-scripts`，加"在浏览器打开"按钮
4. SVG 预览用 DOMPurify 或 `<img>` blob URL
5. Markdown 本地图片授权化（项目内直接显示，外部弹占位+授权按钮）
6. ImageLightbox 同逻辑

---

## 实施步骤

### Step 1: Rust `src-tauri/src/path_access.rs`

```rust
pub enum PathCapability { Read, Write, Delete }

pub struct PathAccessManager {
    fixed_roots: Vec<PathBuf>,        // cwd, ~/.claude.json, ~/.tokenicode/
    session_grants: Mutex<HashMap<String, HashSet<PathBuf>>>,
}

impl PathAccessManager {
    pub fn validate(&self, path: &Path, tab_id: &str, cap: PathCapability) -> Result<PathBuf, String>;
    pub async fn add_grant(&self, tab_id: &str, path: &Path);
    pub async fn clear_grants(&self, tab_id: &str);
}
```

- canonicalize + symlink 解析
- copy/rename 校验 src 和 dest
- 所有文件命令（`lib.rs:3259-3347`）+ skill 接口（`lib.rs:4010-4027`）必过 validate()
- 新增 Tauri command `add_path_grant(tab_id, path)`

### Step 2: HTML/SVG 预览

`FilePreview.tsx:390-402`：
- HTML: `<iframe sandbox="allow-same-origin" srcDoc={content} />` + "在浏览器打开" 按钮 (`openWithDefaultApp`)
- SVG: `DOMPurify.sanitize(content)` 或 `<img src={blobUrl}>`
- 需安装 `dompurify`（`pnpm add dompurify @types/dompurify`）

### Step 3: Markdown 本地图片授权化

`MarkdownRenderer.tsx:16-36`：
- 项目内相对路径 → 直接 readFileBase64
- 绝对路径 → ExternalImagePlaceholder + 授权按钮（openFileDialog → addPathGrant → read）
- `ImageLightbox.tsx:33-37` 同逻辑

### Step 4: grants 来源

- Provider 导入导出（`ProviderManager.tsx`）→ 成功选路径后 invoke addPathGrant
- Drag-drop（`useFileAttachments.ts`）→ drop 事件后 invoke addPathGrant

---

## 测试

- 新增 `src-tauri/tests/path_access.rs` — 多根白名单 + grants + canonicalize 防逃逸
- 77/77 前端测试全过 + 新增 HTML/SVG 预览测试
- tsc + cargo check + clippy

## check agent codex 审查

同前：`codex exec` 三模型并发审代码。禁止 mcp__codex__codex。

## 不允许

- 不 push / 不 PR
- 不改 Phase 1/2 的核心逻辑
