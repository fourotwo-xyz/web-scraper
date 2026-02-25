#!/usr/bin/env node

/**
 * MCP Server — stdio transport
 *
 * Standalone entry point for local testing with the MCP Inspector,
 * Cursor, Claude Desktop, or any stdio-based MCP client.
 *
 * Usage:
 *   npx tsx src/mcp-stdio.ts
 *   npx @modelcontextprotocol/inspector npx tsx src/mcp-stdio.ts
 */

import "dotenv/config";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createMcpServer } from "./mcp.js";

const server = createMcpServer();
const transport = new StdioServerTransport();

await server.connect(transport);
