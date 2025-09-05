# Axentax MCP Compiler

English documentation\
https://github.com/axentax/axentax-mcp-compiler/blob/main/README.md

Axentax 記法（Axentax DSL）を MIDI に変換する MCP サーバーです。各種 MCP クライアント（Codex CLI / Claude Code / Cline など）から利用でき、HTTP API も併設しています。
記法が正しいかを検証するバリデータのみ使用することもできます。

本 README は「単一ファイル実行（dist/axentax-mcp.cjs）」を前提としたユーザー向け手順と、開発者向けのビルド方法・仕組みを記載します。


## 1. ユーザー向け（単一ファイルで使う）

- 前提:
  - Node.js 20+ がインストール済み
  - 本リポジトリのビル済み単一ファイル `dist/axentax-mcp.cjs` を入手\
    https://github.com/axentax/axentax-mcp-compiler/blob/main/dist/axentax-mcp.cjs

- 例: ユーザーディレクトリ配下に配置
  - 配置パス: `~/mcp/axentax-mcp.cjs`
  - 実行: `node ~/mcp/axentax-mcp.cjs`
  - 環境変数（任意）:
    - `MCP_STDIO=1`（MCP の stdio モードを有効化）
    - `PORT=5858`（HTTP ポート、任意）
    - `DATA_DIR=~/mcp/data/midi`（MIDI 保存先）
    - `LOG_LEVEL=info`（ログレベル）
    - `PINO_PRETTY=1`（きれいなログ出力を有効化、任意）

- HTTP の簡易確認（任意）
  - `curl -s http://localhost:5858/health`
  - `curl -s -X POST http://localhost:5858/valid -H 'content-type: application/json' -d '{"axText":"@@ 120 4/4 { C D E }"}'`
  - `curl -s -X POST http://localhost:5858/midi  -H 'content-type: application/json' -d '{"axText":"@@ 120 4/4 { C D E }"}'`


### 1.1 Codex CLI の設定

- 設定ファイル: `~/.codex/config.toml`
- 例（絶対パス推奨）:

```
[mcp_servers.axentax]
command = "node"
args = ["/Users/あなたのユーザー名/mcp/axentax-mcp.cjs"]

[mcp_servers.axentax.env]
MCP_STDIO = "1"
DATA_DIR = "/Users/あなたのユーザー名/mcp/data/midi"
LOG_LEVEL = "info"
```

※ Codex CLI を別ディレクトリから起動しても動くように、`args` は絶対パスにしてください。


### 1.2 Claude Code / Cline / Gemini 等の設定

- それぞれのクライアントが MCP サーバーを外部プロセスとして起動する設定を提供している場合、基本は以下の要素を登録します。
  - サーバーID（例: `axentax`）
  - コマンド: `node`
  - 引数: `[/絶対パス/axentax-mcp.cjs]`
  - 環境変数: `MCP_STDIO=1`, `DATA_DIR=...`, `LOG_LEVEL=info` など
- クライアントごとに設定ファイルの場所・キーが異なります。正確な手順は各クライアントのドキュメントに従ってください。
  - 参考: Cline / Claude Code は VS Code の設定から MCP サーバーを登録できる実装が増えています（拡張のバージョンやドキュメントを参照）。

#### 具体例（設定ファイル）

- Codex CLI（~/.codex/config.toml）

```
[mcp_servers.axentax]
command = "node"
args = ["/Users/あなた/mcp/axentax-mcp.cjs"]

[mcp_servers.axentax.env]
MCP_STDIO = "1"
DATA_DIR = "/Users/あなた/mcp/data/midi"
LOG_LEVEL = "info"
```

- Cline（VS Code の settings.json）
  - ファイルパス例（ユーザー設定）: macOS/Linux: `~/.config/Code/User/settings.json`、Windows: `%APPDATA%\Code\User\settings.json`

```
{
  "cline.mcpServers": [
    {
      "name": "axentax",
      "command": "node",
      "args": ["/Users/あなた/mcp/axentax-mcp.cjs"],
      "env": {
        "MCP_STDIO": "1",
        "DATA_DIR": "/Users/あなた/mcp/data/midi",
        "LOG_LEVEL": "info"
      }
    }
  ]
}
```

- Claude Code（VS Code 拡張）
  - 多くの場合 UI から MCP サーバーを追加できます。設定ファイルに書く場合は、拡張が提供する MCP 設定キー（例: `claude.mcpServers` 等）に、Cline と同等のオブジェクトを登録してください。実際のキー名・構造は拡張のドキュメント/設定スキーマに従ってください。

```
{
  "claude.mcpServers": [
    {
      "name": "axentax",
      "command": "node",
      "args": ["/Users/あなた/mcp/axentax-mcp.cjs"],
      "env": { "MCP_STDIO": "1", "DATA_DIR": "/Users/あなた/mcp/data/midi", "LOG_LEVEL": "info" }
    }
  ]
}
```

- Gemini（対応拡張/クライアントが MCP 設定を提供する場合）
  - MCP サーバーの追加方法はツールごとに異なります。設定ファイルに書く場合は、以下のような一般形を適用してください（実際のキー名はクライアントのドキュメントに従う）。

```
{
  "gemini.mcpServers": [
    {
      "name": "axentax",
      "command": "node",
      "args": ["/Users/あなた/mcp/axentax-mcp.cjs"],
      "env": { "MCP_STDIO": "1", "DATA_DIR": "/Users/あなた/mcp/data/midi", "LOG_LEVEL": "info" }
    }
  ]
}
```


### 1.3 使い方の要点

- ツール（MCP 経由）
  - `validate`: 構文検証のみ（MIDI は生成しません）
  - `compile_to_midi`: MIDI を生成し、`mcp://axentax/midi/{hash}` のリソース URI を返します
    - `resources.read` で base64（`audio/midi`）を取得可能
- テンポ/拍子の指定:
  - Axentax の先頭ヘッダで指定してください（例: `@@ 120 4/4 { ... }`）
  - 別パラメータで `tempo/timeSig` を渡しても適用されません


## 2. 開発者向け（ビルド・仕組み）

- 実装概要
  - 言語/ランタイム: TypeScript / Node.js 20+
  - MCP SDK: `@modelcontextprotocol/sdk`
  - Web: `express`
  - ログ: `pino`（`PINO_PRETTY=1` で pretty 出力）
  - コンパイラ: `axentax-compiler` の `Conductor.convertToObj()` を使用
    - 検証: `convertToObj(false, false, syntax, ...)`（MIDI 生成なし）
    - 生成: `convertToObj(true,  true,  syntax, ...)`（MIDI を ArrayBuffer で取得）
  - キャッシュ: `hash = sha256(axText)`、出力は `DATA_DIR/{hash}.mid`

- セットアップ
  - `npm install`
  - TypeScript ビルド: `npm run build`（`dist/index.js`）
  - 開発実行: `npm run dev`
  - 単一ファイルバンドル: `npm run bundle`（`dist/axentax-mcp.cjs`）
  - バンドル実行: `npm run start:bundle`

- 環境変数
  - `MCP_STDIO=1`（MCP stdio を有効化）
  - `PORT=5858`（HTTP ポート）
  - `DATA_DIR=./data/midi`（MIDI 出力先）
  - `LOG_LEVEL=info` / `PINO_PRETTY=1`

- 注意点
  - 複数のクライアント/ウィンドウで同時に HTTP を起動するとポートが競合します（`EADDRINUSE`）。必要なら `PORT=0`（OS 自動割当）や HTTP 無効化の対応を検討してください。
  - MCP は stdio 通信のためポート不要です。


## 3. HTTP API（任意）

- `GET /health`
  - 200: `{ status: "ok", timestamp: "..." }`
- `POST /valid`
  - Body: `{ "axText": "@@ 120 4/4 { C D E }" }`
  - 成功: `{ ok: true, message: "The syntax has been verified to compile successfully." }`
  - 失敗: `{ ok: false, errors: [...] }`
- `POST /midi`
  - Body: `{ "axText": "@@ 120 4/4 { C D E }" }`
  - 成功: `{ ok: true, hash: "<sha256>", resource: "/midi?midi=<sha256>" }`
- `GET /midi?midi=<hash>`
  - 200: `audio/midi`（バイナリ）


## 4. MCP ツール/リソース仕様

- ツール
  - `validate`（入力）: `{ axText: string }`
  - `compile_to_midi`（入力）: `{ axText: string }`
  - 戻り値（成功時）: `{ ok: true, hash, uri: "mcp://axentax/midi/{hash}", size, mimeType: "audio/midi" }`
- リソース
  - テンプレート: `mcp://axentax/midi/{hash}`
  - `resources.read` で `audio/midi` を base64（`encoding: "base64"`）で返却


## 5. トラブルシュート

- Codex から起動できない/サーバーが見つからない
  - `args` は絶対パスにしてください（作業ディレクトリが異なると相対パスは解決されません）
- Windows のパス文字列
  - TOML のダブルクォートでは `\` はエスケープです。`"C:\\Users\\..."` か、シングルクォートで `'C:\Users\...'` を使ってください
- 単一ファイル（.mjs）で `Dynamic require of 'path' is not supported`
  - `.cjs` バンドル（`dist/axentax-mcp.cjs`）をお使いください


## 6. 関連リンク

- Axentax ドキュメント: https://axentax.github.io/
- Axentax Playground: https://axentax.github.io/axentax-playground/
- Axentax FAQ: https://axentax.github.io/docs/xqa/
- Axentax 設定: https://axentax.github.io/docs/settings/basic-settings/
- Axentax-Compiler リポジトリ: https://github.com/axentax/axentax-compiler
