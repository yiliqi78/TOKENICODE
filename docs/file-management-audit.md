# TOKENICODE 文件管理系统审计（CLI UX 对齐）

> 创建日期：2026-02-25  
> 目标：围绕“简洁、优雅、顺畅”，审计当前文件管理系统中与 CLI 体验不一致、冗余或高摩擦的实现，并给出 vNext 可执行改造清单。

## 1) UX 基线（用于对齐）

以 Claude Code CLI 的交互风格作为上位目标，文件相关体验应满足：

1. **单一真相**：同一状态（文件树、变更、可执行动作）只由一条主链路驱动。  
2. **最少惊讶**：用户操作后反馈明确，失败可见，不出现“看起来成功但实际失败”。  
3. **低冗余**：不提供重复按钮和重复刷新路径，不让用户做系统已经能自动做的事。  
4. **风格一致**：视觉语言和交互密度与主应用保持统一，不出现“像另一个产品模块”。

## 2) 现状实现速览

- 前端状态与行为主入口：`src/stores/fileStore.ts`、`src/components/files/FileExplorer.tsx`、`src/components/files/FilePreview.tsx`。
- 目录监听与刷新编排：`src/App.tsx`（`fs:change` 监听 + debounce refresh）。
- 后端文件树/文件操作：`src-tauri/src/lib.rs`（`read_file_tree`、`copy_file`、`rename_file`、`delete_file`）。
- 前后端桥接：`src/lib/tauri-bridge.ts`。

## 3) 关键问题（按优先级）

## P0（必须先改）

1. **文件树被硬编码深度截断，且没有惰性展开补偿链路**  
   - 前端固定请求 `depth=3`：`src/stores/fileStore.ts:71`、`src/stores/fileStore.ts:87`  
   - 后端默认深度 3，超深目录只返回空 children 占位：`src-tauri/src/lib.rs:1483`、`src-tauri/src/lib.rs:1520`  
   - 结果：深层项目“看不全、点不开”，与用户对文件树预期冲突。

2. **刷新链路重复，容易造成抖动和额外开销**  
   - watcher 已对 created/removed 做 debounce 刷新：`src/App.tsx:287`  
   - copy/rename/delete 后又立即手动刷新：`src/components/files/FileExplorer.tsx:404`、`src/components/files/FileExplorer.tsx:430`、`src/components/files/FileExplorer.tsx:449`  
   - 结果：同一变化可能触发多次 reload，视觉上“跳”，也让状态更难推理。

3. **“文件变更标记”模型粘滞且可能漂移**  
   - `changedFiles` 只增不减（除非手动清空或重载目录）：`src/stores/fileStore.ts:212`、`src/stores/fileStore.ts:222`  
   - UI 强提示 changed count + clear：`src/components/files/FileExplorer.tsx:514`、`src/components/files/FileExplorer.tsx:524`  
   - 结果：标记会偏离真实当前状态，成为噪音而非有效信号。

## P1（核心体验）

4. **刷新控件冗余（Explorer 和 Preview 双刷新）**  
   - Preview 已会在选中文件 modified 时自动重载：`src/components/files/FilePreview.tsx:135`  
   - 同时仍保留手动刷新按钮：`src/components/files/FilePreview.tsx:274`  
   - Explorer 也有刷新按钮：`src/components/files/FileExplorer.tsx:533`。

5. **右键菜单信息密度过高、语义混杂**  
   - 菜单承载插入聊天、复制路径、内部复制粘贴、重命名删除、Reveal/Open/VSCode 等多类动作：`src/components/files/FileExplorer.tsx:101`  
   - 其中 `copyFile/paste` 是“应用内剪贴板”，与系统剪贴板心智不一致，易误解。

6. **异常处理存在静默失败，削弱可控感**  
   - 多处 `catch {}` 直接吞错（paste/refresh/reload 等）：`src/components/files/FileExplorer.tsx:407`、`src/stores/fileStore.ts:94`、`src/stores/fileStore.ts:207`  
   - 用户无从判断是权限问题、路径冲突，还是操作成功。

7. **视觉风格与主界面有割裂感**  
   - 文件图标大量使用 emoji：`src/components/files/FileExplorer.tsx:11`、`src/components/files/FilePreview.tsx:44`  
   - 与其余面板统一 SVG/token 风格不一致。

## P2（可预防问题）

8. **删除文件后预览态可能残留旧内容（状态未收敛）**  
   - 删除会触发 tree refresh，但未见“若当前预览文件被删则关闭预览”收敛逻辑：`src/components/files/FileExplorer.tsx:449`、`src/stores/fileStore.ts:143`。

## 4) vNext 改造清单（可直接执行）

### A. 文件树与刷新主链路（P0）

1. **改为惰性加载树结构**  
   - 新增后端命令（如 `read_dir_children(path)`），只拉当前层。  
   - `TreeNode` 扩展状态：`collapsed/expanded/loading/loaded`，首次展开再请求。  
   - 移除固定深度限制，避免“深度 3 天花板”。

2. **定义单一刷新策略（SSR: Single Source Refresh）**  
   - 结构变化（create/remove/rename）仅由 watcher 驱动 refresh。  
   - 本地操作后先做 optimistic UI 更新，再等 watcher 对齐。  
   - 手动 refresh 降级为兜底入口（放二级菜单，不做主按钮）。

3. **重做 changedFiles 模型**  
   - 分离“瞬时事件流”与“持续状态”：  
     - 事件流：短时高亮/Toast（自动衰减）；  
     - 持续状态：基于真实来源（例如当前树存在性 + 可选 git diff）计算。  
   - 去掉“只能手动 clear 的累计计数”作为主反馈。

### B. 交互与视觉统一（P1）

4. **右键菜单瘦身（默认 4~6 项）**  
   - 一级菜单保留高频：打开、重命名、删除、复制路径、插入聊天。  
   - 低频能力（Reveal、Open default、Open VSCode）收纳到 “More”。  
   - 将“内部复制粘贴”改名为“Duplicate to.../复制到...”并显式说明非系统剪贴板。

5. **统一图标系统**  
   - 用现有 SVG/icon token 体系替换 emoji。  
   - 文件类型图标保留最小集合（code/doc/media/archive/folder）。

6. **统一失败反馈**  
   - 建立 FileOps 错误映射（权限不足、目标已存在、路径无效、IO 失败）。  
   - 所有文件操作失败必须给出一致 toast/system message，禁止静默失败。

7. **简化刷新按钮策略**  
   - Preview 的 refresh 改为“仅在检测到外部冲突或加载失败时显示”。  
   - Explorer 顶栏不再常驻 refresh，避免主流程冗余动作。

### C. 稳定性收尾（P2）

8. **补齐状态收敛规则**  
   - 当前选中文件被删除/重命名后，自动关闭或切换到最近可用文件。  
   - 避免出现“树里没了，预览还在”的悬空状态。

9. **加最小回归用例**  
   - 深目录展开、批量重命名、外部修改、删除当前预览文件、权限失败提示。  
   - 重点验收“单次操作只触发一次可感知刷新”。

## 5) 发布前验收标准

1. 深层目录可逐级展开，不存在深度 3 截断。  
2. copy/rename/delete 后无明显双刷新抖动。  
3. changed 标记可自动收敛，不依赖用户手动清空。  
4. 所有失败都有可读提示，不再静默。  
5. 文件模块视觉风格与主应用一致（图标/间距/交互密度统一）。

---

如果你准备在下个版本直接重构这块，建议先按 **A（主链路）→ B（交互视觉）→ C（稳定性）** 三阶段推进；A 不完成前，B 的打磨收益会被反复抵消。
