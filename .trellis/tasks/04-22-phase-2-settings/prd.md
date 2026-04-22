# Phase 2: Settings Sync + CLI Capability Matrix

## 方案文档

**完整修复方案**：`.trellis/workspace/suyuan/fix-plan-2026-04-21-v3.md`（§7 Phase 2, §2.1-§2.6）
**前置依赖**：Phase 1 已 commit 在 `fix/phase-1-lifecycle` 分支（commit `f5b4a7b`）。本 Phase 基于该分支。

---

## 目标

1. 实现 `spawnConfigHash()` — Provider+Model+ThinkingLevel+PermissionMode+envFingerprint 的哈希
2. handleSubmit 入口加配置一致性检查（hash mismatch → teardown + resume spawn）
3. bypass runtime 真切换（BypassModeMap 接通 AtomicBool）
4. 删除 v7 强制 migration（`settingsStore.ts:296-305`）
5. 更新模型列表（保留 4.6/4.6-1m/4.7/4.7-1m/Sonnet/Haiku）

---

## 实施步骤

### Step 1: spawnConfigHash

`src/lib/api-provider.ts` 新增：
```typescript
export function spawnConfigHash(): string {
  return [
    useProviderStore.getState().activeProviderId,
    useSettingsStore.getState().selectedModel,
    useSettingsStore.getState().thinkingLevel,
    useSettingsStore.getState().sessionMode,
    useProviderStore.getState().getActiveProvider()?.updatedAt ?? '',
  ].join('|');
}
```

### Step 2: handleSubmit 配置一致性

`InputBar.tsx` handleSubmit 入口：
- 读当前 `spawnConfigHash()` 对比 `tab.sessionMeta.spawnConfigHash`
- mismatch 且 `tab.sessionMeta.stdinId` 存在 → `teardownSession('switch')` → 等 process_exit → `spawnSession()` with resume + 新 configSnapshot
- UI 显示 "切换到 XXX..." loading

### Step 3: settings watcher 扩展

`settingsStore.ts:364-389` 当前只 watch sessionMode：
- sessionMode 变化 → 调 `set_permission_mode`（现有，保留）
- model / thinkingLevel / providerId 变化 → **不立即 kill**，只在下次 handleSubmit 时走 mismatch 路径

### Step 4: bypass runtime 真切换（S14）

Rust 侧：
1. `start_claude_session` 中 `bypass_map.register(stdinId, AtomicBool::new(is_bypass))`
2. stdout reader 改读 `Arc<AtomicBool>` 而非闭包捕获的 `is_bypass`
3. `send_control_request` 收到 `set_permission_mode` 时更新 `AtomicBool`
4. `drop_entry` 时 `bypass_map.unregister`

### Step 5: 删除 v7 migration + 更新模型列表

`settingsStore.ts:296-305` 删除 v7 强制迁移。

模型列表更新（用户已拍板）：
- claude-opus-4-7-1m → "Opus 4.7 (1M)"
- claude-opus-4-7 → "Opus 4.7"
- claude-opus-4-6-1m → "Opus 4.6 (1M)"
- claude-opus-4-6 → "Opus 4.6"
- claude-sonnet-4-6 → "Sonnet 4.6"
- claude-haiku-4-5 → "Haiku 4.5"

1M context 变体才加括号，普通模型不加。

### Step 6: 覆盖问题

S4 / S6 / S7 / S14 / S17 / C1（写入完整）/ C8（按 provider apiFormat gate env 注入）/ C9（能力矩阵建模初步）

---

## 测试

- 现有 69 tests 全过
- 新增 `src/__tests__/spawnConfigHash.test.ts`
- tsc --noEmit + cargo check + cargo clippy

## check agent codex 审查

同 Phase 1：check 完成后用 `codex exec` 三模型并发审代码。禁止 mcp__codex__codex。

## 不允许

- 不 push / 不 PR
- 不改 Phase 1 已实施的 sessionLifecycle.ts 核心逻辑
- 不做 Phase 3-5 内容
