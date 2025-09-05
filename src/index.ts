import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
  ListResourcesRequestSchema,
  ListResourceTemplatesRequestSchema,
  ReadResourceRequestSchema
} from "@modelcontextprotocol/sdk/types.js";
import express from "express";
import fs from "fs/promises";
import path from "path";
import crypto from "crypto";
import pino from "pino";

// Use real axentax-compiler
import { Conductor } from "axentax-compiler/dist/conductor.js";

// Wrap real compiler API
async function axValidate(axText: string): Promise<void> {
  const chordDic = new Map();
  const allowAnnotations: any[] = [];
  const mapSeed: any = {};
  const res = Conductor.convertToObj(false, false, axText, allowAnnotations, chordDic as any, mapSeed as any);
  if (res.error) {
    throw { details: [{ message: res.error.message, line: res.error.line, column: res.error.linePos, token: res.error.token }] };
  }
}

async function compile(axText: string, _options?: any): Promise<Buffer> {
  const chordDic = new Map();
  const allowAnnotations: any[] = [];
  const mapSeed: any = {};
  const res = Conductor.convertToObj(true, true, axText, allowAnnotations, chordDic as any, mapSeed as any);
  if (res.error) {
    throw { details: [{ message: res.error.message, line: res.error.line, column: res.error.linePos, token: res.error.token }] };
  }
  const midiBuf = res.midi ? Buffer.from(new Uint8Array(res.midi)) : Buffer.alloc(0);
  return midiBuf;
}

// Logger setup
const logOptions: any = {
  level: process.env.LOG_LEVEL ?? "info"
};

// Enable pretty logging only when explicitly requested to avoid bundling worker issues
if (process.env.PINO_PRETTY === "1") {
  logOptions.transport = { target: "pino-pretty" };
}

const log = pino(logOptions);

// Configuration
const DIR = process.env.DATA_DIR ?? path.resolve("data/midi");
const PORT = Number(process.env.PORT ?? 5858);
const MAX_AX_CHARS = Number(process.env.MAX_AX_CHARS ?? 200000);
const COMPILE_TIMEOUT_MS = Number(process.env.COMPILE_TIMEOUT_MS ?? 20000);

// Utility functions
const sha256 = (s: string) => crypto.createHash("sha256").update(s).digest("hex");
const midiPath = (hash: string) => path.join(DIR, `${hash}.mid`);

// Ensure data directory exists
async function ensureDir() {
  await fs.mkdir(DIR, { recursive: true });
}

// Simple input validators
function ensureString(v: any, name: string, opts?: { min?: number; max?: number }) {
  if (typeof v !== "string") throw new Error(`${name} must be a string`);
  const s = v.trim();
  const min = opts?.min ?? 0;
  const max = opts?.max ?? Infinity;
  if (s.length < min) throw new Error(`${name} must be at least ${min} characters`);
  if (s.length > max) throw new Error(`${name} must be <= ${max} characters`);
  return s;
}

// No options supported: tempo/time signature must be specified in Axentax syntax header.

// Core functions
async function validateAx(axText: string) {
  try {
    await axValidate(axText);
    return { 
      ok: true, 
      message: "The syntax has been verified to compile successfully." 
    };
  } catch (e: any) {
    log.warn({ error: e }, "Validation failed");
    return { 
      ok: false, 
      errors: e?.details ?? [{ message: String(e?.message ?? e) }] 
    };
  }
}

async function compileToMidi(axText: string) {
  const key = axText; // Hash based only on source text
  const hash = sha256(key);
  const outputPath = midiPath(hash);
  
  try {
    // Check if file already exists
    await fs.access(outputPath);
    log.info({ hash }, "Using cached MIDI file");
  } catch {
    // File doesn't exist, compile it
    log.info({ hash }, "Compiling new MIDI file");
    
    const timeoutPromise = new Promise<never>((_, reject) => 
      setTimeout(() => reject(new Error("Compilation timeout")), COMPILE_TIMEOUT_MS)
    );
    
    const compilePromise = compile(axText);
    
    try {
      const buffer = await Promise.race([compilePromise, timeoutPromise]);
      await fs.writeFile(outputPath, buffer);
      log.info({ hash, size: buffer.length }, "MIDI file compiled and saved");
    } catch (error) {
      log.error({ error, hash }, "Compilation failed");
      throw error;
    }
  }
  
  const stat = await fs.stat(outputPath);
  return { hash, size: stat.size };
}

// MCP Server setup
const server = new Server(
  {
    name: "axentax-mcp",
    version: "0.1.0"
  },
  {
    capabilities: {
      tools: {},
      resources: {}
    }
  }
);

// Tool implementations
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: "validate",
        description: "Validate Axentax syntax.",
        inputSchema: {
          type: "object",
          properties: {
            axText: { 
              type: "string", 
              minLength: 1, 
              maxLength: MAX_AX_CHARS,
              description: "Axentax DSL code to validate"
            }
          },
          required: ["axText"]
        }
      },
      {
        name: "compile_to_midi",
        description: "Compile Axentax to MIDI and return a resource URI. Tempo/TimeSig must be specified in Axentax header (e.g., '@@ 120 4/4 { ... }').",
        inputSchema: {
          type: "object",
          properties: {
            axText: { 
              type: "string", 
              minLength: 1, 
              maxLength: MAX_AX_CHARS,
              description: "Axentax DSL code to compile"
            }
          },
          required: ["axText"],
          additionalProperties: false
        }
      }
    ]
  };
});

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = (request.params ?? { name: "", arguments: {} }) as any;
  
  try {
    if (name === "validate") {
      const axText = ensureString(args?.axText, "axText", { min: 1, max: MAX_AX_CHARS });
      const result = await validateAx(axText);
      
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(result, null, 2)
          }
        ]
      };
    }
    
    if (name === "compile_to_midi") {
      const axText = ensureString(args?.axText, "axText", { min: 1, max: MAX_AX_CHARS });
      
      // First validate
      const validationResult = await validateAx(axText);
      if (!validationResult.ok) {
        return {
          content: [
            {
              type: "text", 
              text: JSON.stringify(validationResult, null, 2)
            }
          ]
        };
      }
      
      // Then compile - handle optional options properly
      const { hash, size } = await compileToMidi(axText);
      
      const result = {
        ok: true,
        hash,
        uri: `mcp://axentax/midi/${hash}`,
        size,
        mimeType: "audio/midi"
      };
      
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(result, null, 2)
          }
        ]
      };
    }
    
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({ ok: false, error: `Unknown tool: ${name}` }, null, 2)
        }
      ],
      isError: true
    };
    
  } catch (error) {
    log.error({ error, tool: name }, "Tool execution failed");
    
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({
            ok: false,
            error: error instanceof Error ? error.message : String(error)
          }, null, 2)
        }
      ],
      isError: true
    };
  }
});

// Resource implementations
server.setRequestHandler(ListResourcesRequestSchema, async () => {
  // No static resources; all access is via template URIs.
  return { resources: [] } as any;
});

server.setRequestHandler(ListResourceTemplatesRequestSchema, async () => {
  return {
    resourceTemplates: [
      {
        name: "axentax-midi",
        title: "Axentax MIDI",
        uriTemplate: "mcp://axentax/midi/{hash}",
        mimeType: "audio/midi",
        description: "Compiled MIDI file from Axentax DSL"
      }
    ]
  } as any;
});

server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
  const { uri } = request.params ?? { uri: "" } as any;
  
  const match = uri.match(/^mcp:\/\/axentax\/midi\/([a-f0-9]{64})$/);
  if (!match) {
    throw new Error("Invalid resource URI format");
  }
  
  const hash = match[1]!;
  const filePath = midiPath(hash);
  
  try {
    const buffer = await fs.readFile(filePath);
    
    return {
      contents: [
        {
          uri,
          mimeType: "audio/midi",
          text: buffer.toString("base64"),
          encoding: "base64"
        }
      ]
    };
  } catch (error) {
    log.error({ error, hash }, "Failed to read MIDI file");
    throw new Error(`MIDI file not found: ${hash}`);
  }
});

// HTTP API (concurrent with MCP)
async function startHttpServer() {
  const app = express();
  
  app.use(express.json({ limit: "1mb" }));
  
  // Health check
  app.get("/health", (req, res) => {
    res.json({ status: "ok", timestamp: new Date().toISOString() });
  });
  
  // Validate endpoint
  app.post("/valid", async (req, res) => {
    try {
      const axText = ensureString(req.body?.axText, "axText", { min: 1, max: MAX_AX_CHARS });
      const result = await validateAx(axText);
      
      return result.ok ? res.json(result) : res.status(400).json(result);
    } catch (error) {
      log.error({ error }, "Validation endpoint error");
      return res.status(400).json({
        ok: false,
        error: error instanceof Error ? error.message : "Invalid request"
      });
    }
  });
  
  // Compile endpoint
  app.post("/midi", async (req, res) => {
    try {
      const axText = ensureString(req.body?.axText, "axText", { min: 1, max: MAX_AX_CHARS });
      
      // Validate first
      const validationResult = await validateAx(axText);
      if (!validationResult.ok) {
        return res.status(400).json(validationResult);
      }
      
      // Compile - handle optional options properly
      const { hash } = await compileToMidi(axText);
      
      return res.json({
        ok: true,
        hash,
        resource: `/midi?midi=${hash}`
      });
      
    } catch (error) {
      log.error({ error }, "Compile endpoint error");
      return res.status(400).json({
        ok: false,
        error: error instanceof Error ? error.message : "Compilation failed"
      });
    }
  });
  
  // Get MIDI file
  app.get("/midi", async (req, res) => {
    const hash = String(req.query.midi ?? "");
    
    if (!/^[a-f0-9]{64}$/.test(hash)) {
      return res.status(400).send("Invalid hash format");
    }
    
    try {
      const buffer = await fs.readFile(midiPath(hash));
      
      res.setHeader("Content-Type", "audio/midi");
      res.setHeader("Content-Disposition", `attachment; filename="${hash}.mid"`);
      return res.send(buffer);
    } catch (error) {
      log.error({ error, hash }, "Failed to serve MIDI file");
      return res.status(404).send("MIDI file not found");
    }
  });
  
  // Start server
  app.listen(PORT, () => {
    log.info({ port: PORT }, "HTTP server started");
  });
}

// Main function
async function main() {
  try {
    await ensureDir();
    log.info({ dataDir: DIR }, "Data directory ready");
    
    // Start HTTP server
    await startHttpServer();
    
    // Start MCP server if stdio mode
    if (process.env.MCP_STDIO === "1") {
      const transport = new StdioServerTransport();
      await server.connect(transport);
      log.info("MCP server connected via stdio");
    } else {
      log.info("MCP stdio mode not enabled (set MCP_STDIO=1)");
    }
    
  } catch (error) {
    log.error({ error }, "Failed to start server");
    process.exit(1);
  }
}

// Handle graceful shutdown
process.on("SIGINT", () => {
  log.info("Shutting down gracefully");
  process.exit(0);
});

process.on("SIGTERM", () => {
  log.info("Shutting down gracefully");
  process.exit(0);
});

// Start the server
main();
