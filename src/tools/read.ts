import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ApiClient } from "../services/api-client.js";
import { getQuoteAsset, isSymbol } from "../types.js";

export function registerReadTools(server: McpServer, api: ApiClient): void {

  // ─── tm_get_price ────────────────────────────────────────────
  server.registerTool(
    "tm_get_price",
    {
      title: "Get token price",
      description: `Get the current price of a token in USDC by running a zero-cost quote.

Resolves token symbols (SOL, ETH) to addresses automatically.
Does NOT require an API key — only auth token.

Args:
  - token (string): Token symbol (e.g. "SOL") or contract address
  - chain (string): "solana" or "base" (default: "solana")

Returns: { token, chain, price_usdc, qty_in, qty_out }`,
      inputSchema: {
        token: z.string().describe("Token symbol (SOL, ETH) or contract address"),
        chain: z.enum(["solana", "base"]).default("solana").describe("Blockchain network"),
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async ({ token, chain }) => {
      // Resolve symbol to address if needed
      let baseAsset = token;
      let resolvedChain = chain;

      if (isSymbol(token)) {
        const assets = await api.getAssets();
        const match = assets.find(
          (a) => a.symbol?.toLowerCase() === token.toLowerCase()
        );
        if (!match?.address) {
          return {
            isError: true,
            content: [{ type: "text", text: `Could not resolve symbol "${token}". Use tm_list_assets to see available tokens.` }],
          };
        }
        baseAsset = match.address;
        if (match.chain) resolvedChain = match.chain.toLowerCase() as "solana" | "base";
      }

      const quote = await api.createQuote({
        order_side: "buy",
        chain: resolvedChain,
        base_asset: baseAsset,
        quote_asset: getQuoteAsset(resolvedChain),
        qty: "1",
      });

      const price = parseFloat(quote.qty) / parseFloat(quote.qty_out);

      const output = {
        token: token.toUpperCase(),
        chain: resolvedChain,
        price_usdc: price.toFixed(6),
        qty_in: quote.qty,
        qty_out: quote.qty_out,
        fee: quote.fee,
      };

      return {
        content: [{ type: "text", text: JSON.stringify(output, null, 2) }],
        structuredContent: output,
      };
    }
  );

  // ─── tm_get_balances ─────────────────────────────────────────
  server.registerTool(
    "tm_get_balances",
    {
      title: "Get account balances",
      description: `Get token balances for the authenticated user across all chains.

Args:
  - chain (string, optional): Filter by "solana" or "base"

Returns: Array of { symbol, chain, balance, name }`,
      inputSchema: {
        chain: z.enum(["solana", "base"]).optional().describe("Filter by chain"),
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async ({ chain }) => {
      const resp = await api.getBalances();
      let balances = resp.balances ?? [];

      if (chain) {
        balances = balances.filter(
          (b) => b.chain?.toLowerCase() === chain
        );
      }

      const items = balances.map((b) => ({
        symbol: b.symbol ?? "",
        name: b.name ?? "",
        chain: b.chain ?? "",
        balance: b.balance ?? "0",
      }));

      const output = { count: items.length, balances: items };

      return {
        content: [{ type: "text", text: JSON.stringify(output, null, 2) }],
        structuredContent: output,
      };
    }
  );

  // ─── tm_list_assets ──────────────────────────────────────────
  server.registerTool(
    "tm_list_assets",
    {
      title: "List available tokens",
      description: `List all tokens available for trading on True Markets.

Args:
  - chain (string, optional): Filter by "solana" or "base"

Returns: Array of { symbol, name, chain, address }`,
      inputSchema: {
        chain: z.enum(["solana", "base"]).optional().describe("Filter by chain"),
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async ({ chain }) => {
      let assets = await api.getAssets();

      if (chain) {
        assets = assets.filter(
          (a) => a.chain?.toLowerCase() === chain
        );
      }

      const items = assets.map((a) => ({
        symbol: a.symbol ?? "",
        name: a.name ?? "",
        chain: a.chain ?? "",
        address: a.address ?? "",
      }));

      const output = { count: items.length, assets: items };

      return {
        content: [{ type: "text", text: JSON.stringify(output, null, 2) }],
        structuredContent: output,
      };
    }
  );

  // ─── tm_get_profile ──────────────────────────────────────────
  server.registerTool(
    "tm_get_profile",
    {
      title: "Get account profile",
      description: `Get the authenticated user's profile including email and wallet addresses.

Returns: { email, wallets: [{ chain, address }] }`,
      inputSchema: {},
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async () => {
      const profile = await api.getProfile();

      const wallets = (profile.wallets ?? []).map((w) => ({
        chain: w.chain === "evm" ? "base" : (w.chain ?? ""),
        address: w.address ?? "",
      }));

      const output = { email: profile.email ?? "", wallets };

      return {
        content: [{ type: "text", text: JSON.stringify(output, null, 2) }],
        structuredContent: output,
      };
    }
  );
}
