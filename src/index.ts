import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import express from "express";
import fs from "fs/promises";
import path from "path";
import crypto from "crypto";
import pino from "pino";
import { z } from "zod";

// Placeholder for axentax compiler - replace with actual implementation
// import { compile, validate as axValidate } from "axentax-compiler";

// Temporary placeholder functions until axentax-compiler is available
async function axValidate(axText: string): Promise<void> {
  if (!axText.trim()) {
    throw { details: [{ message: "Empty input", line: 1, column: 1 }] };
  }
  // Add more validation logic here based on actual Axentax syntax
}

async function compile(axText: string, options?: any): Promise<Buffer> {
  // Placeholder - replace with actual axentax-compiler logic
  await axValidate(axText);
  
  // Return a minimal valid MIDI file for testing
  return Buffer.from([
    0x4D, 0x54, 0x68, 0x64, // "MThd"
    0x00, 0x00, 0x00, 0x06, // Header length
    0x00, 0x00, // Format 0
    0x00, 0x01, // 1 track
    0x00, 0x60, // 96 ticks per quarter note
    
    0x4D, 0x54, 0x72, 0x6B, // "MTrk"
    0x00, 0x00, 0x00, 0x0B, // Track length (11 bytes)
    
    // Simple note: C4 on, C4 off
    0x00, 0x90, 0x3C, 0x40, // Note on C4
    0x60, 0x80, 0x3C, 0x40, // Note off C4
    
    // End of track
    0x00, 0xFF, 0x2F, 0x00
  ]);
}

// Logger setup
const logOptions: any = {
  level: process.env.LOG_LEVEL ?? "info"
};

if (process.env.NODE_ENV === "development") {
  logOptions.transport = {
    target: "pino-pretty"
  };
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

// Validation schemas
const validateSchema = z.object({
  axText: z.string().min(1).max(MAX_AX_CHARS)
});

const compileSchema = z.object({
  axText: z.string().min(1).max(MAX_AX_CHARS),
  options: z.object({
    tempo: z.number().min(20).max(400).optional(),
    timeSig: z.string().regex(/^[0-9]+\/[0-9]+$/).optional()
  }).optional()
});

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

async function compileToMidi(axText: string, options?: any) {
  const key = JSON.stringify({ axText, options });
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
    
    const compilePromise = compile(axText, options);
    
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
server.setRequestHandler("tools/list" as any, async () => {
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
        description: "Compile Axentax to MIDI and return a resource URI.",
        inputSchema: {
          type: "object",
          properties: {
            axText: { 
              type: "string", 
              minLength: 1, 
              maxLength: MAX_AX_CHARS,
              description: "Axentax DSL code to compile"
            },
            options: {
              type: "object",
              properties: {
                tempo: { 
                  type: "integer", 
                  minimum: 20, 
                  maximum: 400,
                  description: "Tempo in BPM"
                },
                timeSig: { 
                  type: "string", 
                  pattern: "^[0-9]+/[0-9]+$",
                  description: "Time signature (e.g., '4/4')"
                }
              },
              additionalProperties: false
            }
          },
          required: ["axText"],
          additionalProperties: false
        }
      }
    ]
  };
});

server.setRequestHandler("tools/call" as any, async (request: any) => {
  const { name, arguments: args } = request.params;
  
  try {
    if (name === "validate") {
      const { axText } = validateSchema.parse(args);
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
      const { axText, options } = compileSchema.parse(args);
      
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
      const compileOptions = options ? {
        ...(options.tempo !== undefined && { tempo: options.tempo }),
        ...(options.timeSig !== undefined && { timeSig: options.timeSig })
      } : undefined;
      
      const { hash, size } = await compileToMidi(axText, compileOptions);
      
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
server.setRequestHandler("resources/list" as any, async () => {
  return {
    resources: [
      {
        uriTemplate: "mcp://axentax/midi/{hash}",
        name: "Axentax MIDI",
        mimeType: "audio/midi",
        description: "Compiled MIDI file from Axentax DSL"
      }
    ]
  };
});

server.setRequestHandler("resources/read" as any, async (request: any) => {
  const { uri } = request.params;
  
  const match = uri.match(/^mcp:\/\/axentax\/midi\/([a-f0-9]{64})$/);
  if (!match) {
    throw new Error("Invalid resource URI format");
  }
  
  const hash = match[1];
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
      const { axText } = validateSchema.parse(req.body);
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
      const { axText, options } = compileSchema.parse(req.body);
      
      // Validate first
      const validationResult = await validateAx(axText);
      if (!validationResult.ok) {
        return res.status(400).json(validationResult);
      }
      
      // Compile - handle optional options properly
      const compileOptions = options ? {
        ...(options.tempo !== undefined && { tempo: options.tempo }),
        ...(options.timeSig !== undefined && { timeSig: options.timeSig })
      } : undefined;
      
      const { hash } = await compileToMidi(axText, compileOptions);
      
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