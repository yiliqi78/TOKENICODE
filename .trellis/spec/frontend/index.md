# Frontend Development Guidelines

> Conventions and patterns for TOKENICODE frontend development (React 19 + TypeScript 5.8 + Tailwind CSS 4 + Zustand 5).

---

## Overview

TOKENICODE is a Tauri 2 desktop app wrapping Claude CLI. The frontend lives in `src/` with ~46 components, 10 Zustand stores, 5 custom hooks, and ~14 utility modules. All Tauri IPC goes through a single bridge file.

---

## Guidelines Index

| Guide | Description |
|-------|-------------|
| [Directory Structure](./directory-structure.md) | Full tree, module organization rules, naming conventions |
| [Component Guidelines](./component-guidelines.md) | Component structure, props, store access, styling, i18n, memoization, IPC rules |
| [Hook Guidelines](./hook-guidelines.md) | Hook categories, file structure, return patterns, module-level state, event listeners |
| [State Management](./state-management.md) | 10 store inventory, store file structure, persistence strategies, multi-tab pattern |
| [Quality Guidelines](./quality-guidelines.md) | Build commands, testing (Vitest), 7 forbidden patterns, required patterns, design tokens |
| [Type Safety](./type-safety.md) | Type organization, interface vs type, IPC type boundary, any policy, forbidden patterns |

---

**Language**: All documentation is written in **English**.
