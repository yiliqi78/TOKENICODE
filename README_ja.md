<div align="center">

<img src="icon/图标.svg" alt="TOKENICODE Logo" width="120" />

# TOKENICODE

### Claude Code のための美しいネイティブデスクトップ GUI

[![Version](https://img.shields.io/badge/バージョン-0.1.0-blue?style=flat-square)](https://github.com/tinyzhuang/tokenicode/releases)
[![License](https://img.shields.io/badge/ライセンス-Apache%202.0-green?style=flat-square)](LICENSE)
[![Platform](https://img.shields.io/badge/プラットフォーム-macOS%20%7C%20Windows%20%7C%20Linux-lightgrey?style=flat-square)](#インストール)
[![Tauri](https://img.shields.io/badge/Tauri-2.0-FFC131?style=flat-square&logo=tauri&logoColor=white)](https://tauri.app)
[![React](https://img.shields.io/badge/React-19-61DAFB?style=flat-square&logo=react&logoColor=black)](https://react.dev)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.8-3178C6?style=flat-square&logo=typescript&logoColor=white)](https://www.typescriptlang.org)
[![Rust](https://img.shields.io/badge/Rust-2021-DEA584?style=flat-square&logo=rust&logoColor=black)](https://www.rust-lang.org)

**TOKENICODE** は強力な [Claude Code CLI](https://docs.anthropic.com/en/docs/claude-code) をリッチなネイティブデスクトップ体験で包みます — ファイルエクスプローラー、セッション管理、スナップショット/巻き戻し、スラッシュコマンドなどの機能を備えています。

[**ダウンロード**](#インストール) | [**機能**](#-機能) | [**開発**](#-開発ガイド) | [**コントリビュート**](#-コントリビュート)

---

**[English](README.md)** | **[中文](README_zh.md)** | **[日本語](README_ja.md)**

</div>

## 機能

| | | | |
|:---:|:---:|:---:|:---:|
| **ストリーミングチャット** | **ファイルエクスプローラー** | **セッション管理** | **スナップショット＆巻き戻し** |
| NDJSONストリーミングによるリアルタイム会話。思考中、出力中、ツール実行中の状態を表示 | プロジェクトファイルの閲覧、プレビュー、編集。シンタックスハイライト対応 | 永続化されたセッション。検索、リネーム、エクスポート、再開に対応 | Claude がファイルを変更する前にスナップショットを自動作成。任意のターンに巻き戻し可能 |
| **スラッシュコマンド** | **コマンドパレット** | **i18n** | **テーマ** |
| Claude Code の全スラッシュコマンドをサポート（オートコンプリート付き） | `Cmd+K` で素早くアクセスできるコマンドパレット | 中国語・英語対応の拡張可能な翻訳システム | ライト、ダーク、システム連動テーマ。複数のアクセントカラー |

## スクリーンショット

<div align="center">

> スクリーンショットは初回公開リリース後に追加されます。
>
> アプリは3カラムレイアウトを採用しています：左サイドバーに会話リスト、中央にチャットパネル、右側にファイル/エージェント/設定などの補助パネルがあります。

</div>

## クイックスタート

### 前提条件

- [Claude Code CLI](https://docs.anthropic.com/en/docs/claude-code) がインストール済みで認証されていること
- macOS 12+、Windows 10+、または Linux（WebKit2GTK が必要）

### インストール

#### macOS

[Releases](https://github.com/tinyzhuang/tokenicode/releases) から最新の `.dmg` をダウンロードし、**TOKENICODE** をアプリケーションフォルダにドラッグしてください。

#### Windows

[Releases](https://github.com/tinyzhuang/tokenicode/releases) から最新の `.msi` インストーラーをダウンロードして実行してください。

#### Linux

[Releases](https://github.com/tinyzhuang/tokenicode/releases) から `.AppImage` または `.deb` パッケージをダウンロードしてください。

### 初回起動

1. TOKENICODE を開きます
2. ウェルカム画面または入力バーからプロジェクトフォルダを選択します
3. チャットを開始 — Claude CLI セッションがバックグラウンドでシームレスに動作します

## 開発ガイド

### システム要件

| ツール | バージョン | 用途 |
|--------|-----------|------|
| [Node.js](https://nodejs.org) | 18+ | JavaScript ランタイム |
| [pnpm](https://pnpm.io) | 9+ | パッケージマネージャー |
| [Rust](https://rustup.rs) | 1.75+ | バックエンドコンパイル |
| [Tauri CLI](https://tauri.app) | 2.x | アプリバンドル＆開発サーバー |

### セットアップ

```bash
# リポジトリをクローン
git clone https://github.com/tinyzhuang/tokenicode.git
cd tokenicode

# 依存関係をインストール
pnpm install

# 開発モードで起動（Vite + Tauri）
pnpm tauri dev
```

### コマンド一覧

| コマンド | 説明 |
|---------|------|
| `pnpm tauri dev` | 開発モード（Vite 開発サーバー + Tauri アプリ） |
| `pnpm tauri build` | プロダクションビルド |
| `pnpm dev` | フロントエンドのみ（Vite、ポート 1420） |
| `pnpm build` | 型チェック + Vite ビルド（フロントエンド） |
| `cargo check` | Rust 型チェック（`src-tauri/` ディレクトリ内） |
| `cargo clippy` | Rust リンティング（`src-tauri/` ディレクトリ内） |

### プロジェクト構成

```
tokenicode/
├── src/                          # フロントエンド（React + TypeScript）
│   ├── components/
│   │   ├── chat/                 # チャットパネル、メッセージ、入力バー、巻き戻し、スラッシュコマンド
│   │   ├── layout/               # アプリシェル、サイドバー、セカンダリパネル
│   │   ├── files/                # ファイルエクスプローラー、プレビュー、プロジェクトセレクター
│   │   ├── conversations/        # セッションリスト、エクスポート
│   │   ├── commands/             # コマンドパレット
│   │   ├── agents/               # エージェント活動パネル
│   │   ├── skills/               # スキル管理パネル
│   │   ├── mcp/                  # MCP サーバー管理
│   │   ├── settings/             # 設定パネル
│   │   └── shared/               # Markdown レンダラー、画像ライトボックス
│   ├── stores/                   # Zustand ステート管理（8つの独立ストア）
│   ├── hooks/                    # useClaudeStream、useFileAttachments、useRewind
│   └── lib/                      # tauri-bridge.ts、i18n.ts、turns.ts
├── src-tauri/                    # バックエンド（Rust）
│   ├── src/
│   │   ├── lib.rs                # 全 Tauri コマンドハンドラー
│   │   └── commands/             # Claude CLI プロセス管理
│   ├── Cargo.toml
│   └── tauri.conf.json
├── public/                       # 静的アセット
└── icon/                         # アプリアイコン SVG
```

## アーキテクチャ

```
┌──────────────────────────────────────────────────────────────┐
│                        TOKENICODE                            │
├──────────────┬───────────────────┬───────────────────────────┤
│ サイドバー    │   チャットパネル    │    セカンダリパネル         │
│              │                   │（ファイル/エージェント/設定）  │
│ 会話リスト    │  メッセージ        │                           │
│ プロジェクト  │  入力バー          │  ファイルエクスプローラー    │
│ セレクター    │  スラッシュコマンド  │  ファイルプレビュー         │
│ テーマ切替    │  巻き戻しパネル    │  エージェント活動           │
│              │  モードセレクター   │  スキル管理                │
│              │  モデルセレクター   │  MCP サーバー              │
│              │                   │  設定                     │
├──────────────┴───────────────────┴───────────────────────────┤
│                    Zustand Stores（8つ）                       │
│  chatStore · sessionStore · fileStore · settingsStore         │
│  snapshotStore · agentStore · skillStore · commandStore       │
├──────────────────────────────────────────────────────────────┤
│                  tauri-bridge.ts（IPC ブリッジ）               │
├──────────────────────────────────────────────────────────────┤
│                   Tauri invoke() / events                     │
├──────────────────────────────────────────────────────────────┤
│                  Rust バックエンド（lib.rs）                    │
│  セッション管理 · ファイル操作 · Git · スキル · エージェント · 監視│
├──────────────────────────────────────────────────────────────┤
│               Claude Code CLI（サブプロセス）                   │
│            --output-format stream-json                        │
└──────────────────────────────────────────────────────────────┘
```

### 設計上の判断

| 判断 | 理由 |
|------|------|
| 単一 IPC ブリッジ（`tauri-bridge.ts`） | フロントエンドとバックエンド間の全呼び出しを1ファイルに集約 — 監査・保守が容易 |
| NDJSON ストリーミング | Claude CLI が改行区切りの JSON を出力。行ごとに解析してリアルタイム更新を実現 |
| 8つの独立した Zustand ストア | 各関心事を分離 — モノリシックな状態なし、理解しやすい設計 |
| 透明タイトルバー | macOS ネイティブの信号機ボタン付き外観 |
| 変更前のスナップショット | Claude がファイルを編集する前に内容をキャプチャし、安全なロールバックを実現 |
| `--resume` フラグによるセッション再開 | フォローアップごとに新しい CLI プロセスを起動し、セッション ID を渡して会話を継続 |

## 技術スタック

### フロントエンド

| 技術 | バージョン | 用途 |
|------|-----------|------|
| ![React](https://img.shields.io/badge/-React-61DAFB?style=flat-square&logo=react&logoColor=black) | 19.1 | UI フレームワーク |
| ![TypeScript](https://img.shields.io/badge/-TypeScript-3178C6?style=flat-square&logo=typescript&logoColor=white) | 5.8 | 型安全性 |
| ![Tailwind](https://img.shields.io/badge/-Tailwind%20CSS-06B6D4?style=flat-square&logo=tailwindcss&logoColor=white) | 4.1 | ユーティリティファーストスタイリング |
| ![Zustand](https://img.shields.io/badge/-Zustand-433E38?style=flat-square) | 5.0 | ステート管理 |
| ![CodeMirror](https://img.shields.io/badge/-CodeMirror-D30707?style=flat-square) | 6.x | コード編集＆プレビュー |
| ![Vite](https://img.shields.io/badge/-Vite-646CFF?style=flat-square&logo=vite&logoColor=white) | 7.0 | ビルドツール＆開発サーバー |

### バックエンド

| 技術 | バージョン | 用途 |
|------|-----------|------|
| ![Rust](https://img.shields.io/badge/-Rust-DEA584?style=flat-square&logo=rust&logoColor=black) | 2021 | ネイティブバックエンド |
| ![Tauri](https://img.shields.io/badge/-Tauri-FFC131?style=flat-square&logo=tauri&logoColor=white) | 2.0 | デスクトップフレームワーク |
| ![Tokio](https://img.shields.io/badge/-Tokio-232323?style=flat-square) | 1.x | 非同期ランタイム |
| ![Serde](https://img.shields.io/badge/-Serde-DEA584?style=flat-square) | 1.x | シリアライゼーション |

## 機能の詳細

### ストリーミングチャット

NDJSON ストリーミングを使用した Claude Code とのリアルタイム会話です。UIは異なるフェーズを明確に表示します — 思考中、出力中、ツール実行中 — それぞれアニメーションインジケーター付きです。

### ファイルエクスプローラー

プロジェクトのディレクトリツリー全体を展開/折りたたみで閲覧できます。Claude によって変更されたファイルは変更マーカーでハイライトされます。ダブルクリックで VS Code で開くか、内蔵の CodeMirror エディターで直接プレビューできます（完全なシンタックスハイライト対応）。

### スナップショット＆巻き戻し

Claude がファイルを変更するたびに、事前にスナップショットが作成されます。巻き戻しパネル（Rewind Panel）を使用して、任意の会話ターンにロールバックできます — コード、会話、またはその両方を独立して復元できます。

### セッション管理

すべての Claude Code セッションは永続化され、検索可能です。以前のセッションの再開、リネーム、Markdown/JSON へのエクスポート、Finder でのセッションファイル表示が可能です。

### スラッシュコマンド

Claude Code の全スラッシュコマンド（`/ask`、`/plan`、`/compact`、`/model` など）を完全サポート。ビルトインコマンド、プロジェクトコマンド、スキルを表示するオートコンプリートポップオーバー付きです。

### コマンドパレット

`Cmd+K` を押してクイックアクセスコマンドパレットを開きます。新しいチャットの開始、パネルの切り替え、テーマの変更などが可能です。

### エージェント活動

Claude のサブエージェント活動をリアルタイムで監視します。各エージェントの起動、思考、ツール実行、完了状態を確認できます。

### スキル＆MCP

Claude Code スキル（作成、編集、有効化/無効化）と MCP サーバー接続をUIから直接管理できます。

### ファイル編集

内蔵の CodeMirror エディターでファイルを直接編集できます。12以上の言語のシンタックスハイライトに対応しています。アプリを離れることなく変更を保存できます。

### 国際化

中国語と英語の完全サポート。すべてのユーザー向け文字列は統一された i18n システムを通じて管理されます。設定からロケールを変更できます。

## キーボードショートカット

| ショートカット | アクション |
|---------------|-----------|
| `Cmd+K` | コマンドパレットを開く |
| `Cmd+N` | 新しいチャット |
| `Cmd+B` | サイドバーを切り替え |
| `Cmd+.` | ファイルパネルを切り替え |
| `Cmd+,` | 設定を開く |
| `Cmd+Enter` | メッセージを送信 |
| `Cmd++` / `Cmd+-` | フォントサイズを調整 |
| `Cmd+0` | フォントサイズをリセット |
| `Escape` | オーバーレイを閉じる / キャンセル |

## コントリビュート

コントリビュートを歓迎します！参加方法は以下の通りです：

### ワークフロー

1. リポジトリをフォーク
2. フィーチャーブランチを作成：`git checkout -b feat/my-feature`
3. 以下のコードスタイルに従って変更
4. 規約に沿ったコミットメッセージ：`feat: 新機能を追加`
5. プッシュして Pull Request を作成

### コードスタイル

- **フロントエンド**：TypeScript strict モード、Tailwind CSS スタイリング、Zustand ステート管理
- **バックエンド**：標準 Rust フォーマット（`cargo fmt`）、Clippy 警告はエラーとして扱う
- **コミット**：Conventional Commits 形式（`feat:`、`fix:`、`refactor:`、`docs:`、`chore:`）

### バグ報告

Issue に以下の情報をご記載ください：
- 再現手順
- 期待される動作と実際の動作
- OS とアプリのバージョン
- コンソール出力（該当する場合）

## ライセンス

本プロジェクトは **Apache License 2.0** でライセンスされています — 詳細は [LICENSE](LICENSE) ファイルをご覧ください。

## 謝辞

- [Anthropic](https://anthropic.com) — Claude Code CLI
- [Tauri](https://tauri.app) — ネイティブデスクトップフレームワーク
- [React](https://react.dev) とオープンソースコミュニティ

---

<div align="center">

**TOKENICODE が役に立ったら、ぜひスターをお願いします！**

</div>
