/**
 * MCP Server — Streamable HTTP transport
 *
 * Exposes the web-scraper as an MCP tool so LLM clients (Cursor, Claude Desktop, etc.)
 * can call it directly. Mounted on the existing Express app at /mcp.
 *
 * Transport: Streamable HTTP (stateful sessions) — required for cloud hosting (EigenCloud).
 */

import { randomUUID } from "node:crypto";
import type { Express, Request, Response } from "express";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import {
  isInitializeRequest,
  type CallToolResult,
} from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";

import { extractUrl } from "./services/simplescraper.js";

export function createMcpServer(): McpServer {
  const server = new McpServer(
    { name: "web-scraper", version: "1.0.0" },
    {
      capabilities: {
        logging: {},
        tools: { listChanged: false },
      },
    },
  );

  server.tool(
    "scrape",
    "Scrape a URL and return metadata, optionally with markdown or HTML content",
    {
      url: z.string().url().describe("The URL to scrape"),
      markdown: z
        .boolean()
        .optional()
        .default(true)
        .describe("Include markdown of the page content"),
      html: z
        .boolean()
        .optional()
        .default(false)
        .describe("Include raw HTML of the page"),
    },
    async ({ url, markdown, html }): Promise<CallToolResult> => {
      const result = await extractUrl(url, { markdown, html });

      if (!result.ok) {
        return {
          isError: true,
          content: [{ type: "text", text: `Scrape failed: ${result.error}` }],
        };
      }

      const { data } = result;

      const parts: CallToolResult["content"] = [
        {
          type: "text",
          text: JSON.stringify(
            {
              url: data.url,
              status: data.status,
              date_scraped: data.date_scraped,
              metadata: data.metadata,
            },
            null,
            2,
          ),
        },
      ];

      if (data.markdown) {
        parts.push({ type: "text", text: data.markdown });
      }
      if (data.html) {
        parts.push({ type: "text", text: data.html });
      }

      return { content: parts };
    },
  );

  return server;
}

/**
 * Mount the MCP Streamable HTTP endpoints on an existing Express app.
 *
 * POST /mcp — client→server JSON-RPC (init + tool calls)
 * GET  /mcp — server→client SSE stream (notifications)
 * DELETE /mcp — session teardown
 */
export function mountMcp(app: Express): void {
  const mcpServer = createMcpServer();

  const transports = new Map<string, StreamableHTTPServerTransport>();

  app.post("/mcp", async (req: Request, res: Response) => {
    try {
      const sessionId = req.headers["mcp-session-id"] as string | undefined;

      if (sessionId && transports.has(sessionId)) {
        const transport = transports.get(sessionId)!;
        await transport.handleRequest(req, res, req.body);
        return;
      }

      if (!sessionId && isInitializeRequest(req.body)) {
        const transport = new StreamableHTTPServerTransport({
          sessionIdGenerator: () => randomUUID(),
          enableJsonResponse: true,
          onsessioninitialized: (sid) => {
            transports.set(sid, transport);
          },
        });

        transport.onclose = () => {
          const sid = transport.sessionId;
          if (sid) transports.delete(sid);
        };

        await mcpServer.connect(transport);
        await transport.handleRequest(req, res, req.body);
        return;
      }

      res.status(400).json({
        jsonrpc: "2.0",
        error: { code: -32000, message: "Bad Request: no valid session ID or initialization request" },
        id: null,
      });
    } catch (err) {
      console.error("[mcp] POST error:", err);
      if (!res.headersSent) {
        res.status(500).json({
          jsonrpc: "2.0",
          error: { code: -32603, message: "Internal server error" },
          id: null,
        });
      }
    }
  });

  app.get("/mcp", async (req: Request, res: Response) => {
    const sessionId = req.headers["mcp-session-id"] as string | undefined;
    if (!sessionId || !transports.has(sessionId)) {
      res.status(400).send("Invalid or missing session ID");
      return;
    }
    const transport = transports.get(sessionId)!;
    await transport.handleRequest(req, res);
  });

  app.delete("/mcp", async (req: Request, res: Response) => {
    const sessionId = req.headers["mcp-session-id"] as string | undefined;
    if (!sessionId || !transports.has(sessionId)) {
      res.status(400).send("Invalid or missing session ID");
      return;
    }
    const transport = transports.get(sessionId)!;
    await transport.handleRequest(req, res);
  });

  console.log("  MCP server mounted at /mcp (Streamable HTTP)");
}
