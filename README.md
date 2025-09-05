# Axentax MCP Compiler

日本語ドキュメント\
https://github.com/axentax/axentax-mcp-compiler/blob/main/README.ja.md

An MCP server that converts Axentax DSL into MIDI. It works with MCP‑enabled clients such as Codex CLI, Claude Code, and Cline, and also exposes a minimal HTTP API.
You can also use just the validator to verify that the syntax is correct.

This README focuses on single‑file usage (dist/axentax‑mcp.cjs) for end users, followed by developer notes about building and internals.


## 1. For Users (single‑file usage)

- Requirements:
  - Node.js 20+
  - The bundled single file `dist/axentax-mcp.cjs`\
  https://github.com/axentax/axentax-mcp-compiler/blob/main/dist/axentax-mcp.cjs

- Example placement under your home directory
  - Path: `~/mcp/axentax-mcp.cjs`
  - Run: `node ~/mcp/axentax-mcp.cjs`
  - Optional environment variables:
    - `MCP_STDIO=1` (enable MCP stdio mode)
    - `PORT=5858` (HTTP port)
    - `DATA_DIR=~/mcp/data/midi` (MIDI output directory)
    - `LOG_LEVEL=info` (pino log level)
    - `PINO_PRETTY=1` (pretty logging)

- Quick HTTP checks (optional)
  - `curl -s http://localhost:5858/health`
  - `curl -s -X POST http://localhost:5858/valid -H 'content-type: application/json' -d '{"axText":"@@ 120 4/4 { C D E }"}'`
  - `curl -s -X POST http://localhost:5858/midi  -H 'content-type: application/json' -d '{"axText":"@@ 120 4/4 { C D E }"}'`


### 1.1 Codex CLI configuration

- File: `~/.codex/config.toml` (use absolute paths)

```
[mcp_servers.axentax]
command = "node"
args = ["/Users/you/mcp/axentax-mcp.cjs"]

[mcp_servers.axentax.env]
MCP_STDIO = "1"
DATA_DIR = "/Users/you/mcp/data/midi"
LOG_LEVEL = "info"
```

Note: Use absolute paths so it works regardless of Codex’s working directory.


### 1.2 Claude Code / Cline / Gemini

Register the server as an external MCP process with:
- Server name/id (e.g. `axentax`)
- Command: `node`
- Args: `[/absolute/path/axentax-mcp.cjs]`
- Env: `MCP_STDIO=1`, `DATA_DIR=...`, `LOG_LEVEL=info`

Concrete examples:

- Cline (VS Code settings.json)
  - Typical paths: macOS/Linux `~/.config/Code/User/settings.json` / Windows `%APPDATA%\Code\User\settings.json`

```
{
  "cline.mcpServers": [
    {
      "name": "axentax",
      "command": "node",
      "args": ["/Users/you/mcp/axentax-mcp.cjs"],
      "env": {
        "MCP_STDIO": "1",
        "DATA_DIR": "/Users/you/mcp/data/midi",
        "LOG_LEVEL": "info"
      }
    }
  ]
}
```

- Claude Code (VS Code extension)
  - Many builds allow adding MCP servers via UI. If specifying in settings, use the extension’s MCP settings key (e.g. `claude.mcpServers`) with an object similar to Cline’s example.

```
{
  "claude.mcpServers": [
    {
      "name": "axentax",
      "command": "node",
      "args": ["/Users/you/mcp/axentax-mcp.cjs"],
      "env": { "MCP_STDIO": "1", "DATA_DIR": "/Users/you/mcp/data/midi", "LOG_LEVEL": "info" }
    }
  ]
}
```

- Gemini (if your client supports MCP configuration)

```
{
  "gemini.mcpServers": [
    {
      "name": "axentax",
      "command": "node",
      "args": ["/Users/you/mcp/axentax-mcp.cjs"],
      "env": { "MCP_STDIO": "1", "DATA_DIR": "/Users/you/mcp/data/midi", "LOG_LEVEL": "info" }
    }
  ]
}
```


### 1.3 Usage notes

- MCP tools
  - `validate`: syntax validation only (does not generate MIDI)
  - `compile_to_midi`: generates MIDI and returns `mcp://axentax/midi/{hash}`
    - Fetch with `resources.read` → `audio/midi` base64
- Tempo/time signature
  - Must be specified in the Axentax header, e.g. `@@ 120 4/4 { ... }`
  - Separate `tempo/timeSig` parameters are not applied


## 2. For Developers (build & internals)

- Stack
  - TypeScript / Node.js 20+
  - MCP SDK: `@modelcontextprotocol/sdk`
  - Web: `express`
  - Logging: `pino` (`PINO_PRETTY=1` for pretty output)
  - Compiler: `axentax-compiler` `Conductor.convertToObj()`
    - Validate: `convertToObj(false, false, syntax, ...)` (no MIDI)
    - Compile:  `convertToObj(true,  true,  syntax, ...)` (MIDI as ArrayBuffer)
  - Caching: `hash = sha256(axText)`; output at `DATA_DIR/{hash}.mid`

- Setup
  - `npm install`
  - TS build: `npm run build` (dist/index.js)
  - Dev run: `npm run dev`
  - Bundle single file: `npm run bundle` (dist/axentax-mcp.cjs)
  - Run bundle: `npm run start:bundle`

- Env vars
  - `MCP_STDIO=1`, `PORT=5858`, `DATA_DIR=./data/midi`, `LOG_LEVEL=info`, `PINO_PRETTY=1`

- Notes
  - Concurrent HTTP instances can conflict on a fixed port (`EADDRINUSE`). Consider `PORT=0` (auto) or an HTTP disable switch if needed.
  - MCP uses stdio; no port is required for MCP itself.


## 3. HTTP API (optional)

- `GET /health` → `{ status: "ok", timestamp: "..." }`
- `POST /valid` with `{ axText }` → `{ ok: true/false, ... }`
- `POST /midi`  with `{ axText }` → `{ ok: true, hash, resource: "/midi?midi=<hash>" }`
- `GET /midi?midi=<hash>` → `audio/midi`


## 4. MCP Tools & Resources

- Tools
  - `validate` input: `{ axText: string }`
  - `compile_to_midi` input: `{ axText: string }`
  - Success: `{ ok: true, hash, uri: "mcp://axentax/midi/{hash}", size, mimeType: "audio/midi" }`
- Resources
  - Template: `mcp://axentax/midi/{hash}`
  - `resources.read` returns base64 `audio/midi` (`encoding: "base64"`)


## 5. Troubleshooting

- Codex cannot start the server / not found
  - Use absolute paths in `args` (relative paths depend on working directory)
- Windows paths in TOML
  - In double quotes, backslashes must be escaped. Use `"C:\\Users\\..."` or single quotes `'C:\Users\...'`.
- Single‑file `.mjs` errors like `Dynamic require of 'path'`
  - Use the CJS bundle: `dist/axentax-mcp.cjs`


## 6. References

- Axentax Docs: https://axentax.github.io/
- Axentax Playground: https://axentax.github.io/axentax-playground/
- Axentax FAQ: https://axentax.github.io/docs/xqa/
- Axentax Settings: https://axentax.github.io/docs/settings/basic-settings/
- Axentax‑Compiler Repository: https://github.com/axentax/axentax-compiler
