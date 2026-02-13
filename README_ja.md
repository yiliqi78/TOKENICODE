<div align="center">

<img src="icon/图标.svg" alt="TOKENICODE Logo" width="120" />

# TOKENICODE

### Claude Code のための美しいネイティブデスクトップ GUI

[![Version](https://img.shields.io/badge/バージョン-0.1.1-blue?style=flat-square)](https://github.com/yiliqi78/TOKENICODE/releases)
[![License](https://img.shields.io/badge/ライセンス-Apache%202.0-green?style=flat-square)](LICENSE)
[![Platform](https://img.shields.io/badge/プラットフォーム-macOS%20%7C%20Windows%20%7C%20Linux-lightgrey?style=flat-square)](#インストール)
[![Tauri](https://img.shields.io/badge/Tauri-2.0-FFC131?style=flat-square&logo=tauri&logoColor=white)](https://tauri.app)
[![React](https://img.shields.io/badge/React-19-61DAFB?style=flat-square&logo=react&logoColor=black)](https://react.dev)

**TOKENICODE** は強力な [Claude Code CLI](https://docs.anthropic.com/en/docs/claude-code) をリッチなネイティブデスクトップ体験で包みます — ファイルエクスプローラー、セッション管理、スナップショット/巻き戻し、スラッシュコマンドなどの機能を備えています。

[**ダウンロード**](#インストール) | [**機能詳細**](#機能の詳細)

---

**[English](README.md)** | **[中文](README_zh.md)** | **[日本語](README_ja.md)**

</div>

## 機能一覧

| | | | |
|:---:|:---:|:---:|:---:|
| **ストリーミングチャット** | **ファイルエクスプローラー** | **セッション管理** | **スナップショット＆巻き戻し** |
| NDJSONストリーミングによるリアルタイム会話。思考中、出力中、ツール実行中の状態を表示 | プロジェクトファイルの閲覧、プレビュー、編集。シンタックスハイライト対応 | 永続化されたセッション。検索、リネーム、エクスポート、再開に対応 | Claude がファイルを変更する前にスナップショットを自動作成。任意のターンに巻き戻し可能 |
| **スラッシュコマンド** | **コマンドパレット** | **i18n** | **テーマ** |
| Claude Code の全スラッシュコマンドをサポート（オートコンプリート付き） | `Cmd+K` で素早くアクセスできるコマンドパレット | 中国語・英語対応の拡張可能な翻訳システム | ライト、ダーク、システム連動テーマ。複数のアクセントカラー |

## クイックスタート

### 前提条件

- [Claude Code CLI](https://docs.anthropic.com/en/docs/claude-code) がインストール済みで認証されていること
- macOS 12+、Windows 10+、または Linux（WebKit2GTK が必要）

### インストール

#### macOS

[Releases](https://github.com/yiliqi78/TOKENICODE/releases) から最新の `.dmg` をダウンロードし、**TOKENICODE** をアプリケーションフォルダにドラッグしてください。

#### Windows

[Releases](https://github.com/yiliqi78/TOKENICODE/releases) から最新の `.msi` または `.exe` インストーラーをダウンロードして実行してください。

#### Linux

[Releases](https://github.com/yiliqi78/TOKENICODE/releases) から `.AppImage`、`.deb`、または `.rpm` パッケージをダウンロードしてください。

### 初回起動

1. TOKENICODE を開きます
2. ウェルカム画面または入力バーからプロジェクトフォルダを選択します
3. チャットを開始 — Claude CLI セッションがバックグラウンドでシームレスに動作します

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

## インターフェースプレビュー

**メインインターフェース** — 3カラムレイアウト
![メインインターフェース](screenshots/main-interface.png)

**ストリーミングチャット** — リアルタイム思考＆出力
![ストリーミングチャット](screenshots/streaming-chat.png)

**ファイルエクスプローラー** — シンタックスハイライト付きプレビュー
![ファイルエクスプローラー](screenshots/file-explorer.png)

**ファイル編集** — 内蔵 CodeMirror エディター、12以上の言語対応
![ファイル編集](screenshots/file-editing.png)

**スラッシュコマンド** — 全コマンドのオートコンプリート
![スラッシュコマンド](screenshots/slash-commands.png)

**スナップショット＆巻き戻し** — 任意のターンにロールバック
![巻き戻し](screenshots/rewind.png)

**スキル管理** — スキルの作成、編集、管理
![スキル管理](screenshots/skills.png)

**HTMLプレビュー** — HTMLファイルのライブプレビュー
![HTMLプレビュー](screenshots/html-preview.png)

**設定** — テーマ、アクセントカラー、i18n
![設定](screenshots/settings.png)

## コントリビュート

コントリビュートを歓迎します！Issue または Pull Request をお送りください。

- リポジトリをフォークしてフィーチャーブランチを作成：`git checkout -b feat/my-feature`
- 規約に沿ったコミットメッセージ：`feat: 新機能を追加`
- プッシュして Pull Request を作成

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
