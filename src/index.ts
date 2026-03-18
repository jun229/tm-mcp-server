#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { AuthManager } from "./services/auth.js";
import { ApiClient } from "./services/api-client.js";
import { Signer } from "./services/signer.js";
import { registerReadTools } from "./tools/read.js";
import { registerTradeTools } from "./tools/trade.js";

async function main(): Promise<void> {
  const server = new McpServer({
    name: "truemarkets-mcp-server",
    version: "0.1.0",
  });

  // Initialize services
  const auth = new AuthManager();
  const api = new ApiClient(auth);

  // Signer is lazy — only constructed when a trade tool needs it
  const getSigner = (): Signer => {
    const apiKey = auth.getApiKey();
    return new Signer(apiKey);
  };

  // Register all tools
  registerReadTools(server, api);
  registerTradeTools(server, api, getSigner);

  // Connect via stdio (agent spawns us as a subprocess)
  const transport = new StdioServerTransport();
  await server.connect(transport);

  // Log to stderr (stdout is reserved for MCP protocol)
  console.error("truemarkets-mcp-server started (stdio transport)");
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
