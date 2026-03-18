import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ApiClient, QuoteResponse } from "../services/api-client.js";
import type { Signer } from "../services/signer.js";
import { getQuoteAsset, isSymbol, txExplorerUrl } from "../types.js";

/**
 * In-memory quote cache. Quotes are held for 60 seconds so the agent
 * can inspect a quote and then decide whether to execute it — using
 * the SAME quote, not a fresh one. This is the core improvement over
 * the CLI's two-quote problem.
 */
const quoteCache = new Map<string, { quote: QuoteResponse; expiresAt: number }>();

function cacheQuote(quote: QuoteResponse): void {
  const ttl = 60_000; // 60 seconds
  quoteCache.set(quote.quote_id, {
    quote,
    expiresAt: Date.now() + ttl,
  });
}

function getCachedQuote(quoteId: string): QuoteResponse | null {
  const entry = quoteCache.get(quoteId);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    quoteCache.delete(quoteId);
    return null;
  }
  return entry.quote;
}

export function registerTradeTools(
  server: McpServer,
  api: ApiClient,
  getSigner: () => Signer
): void {

  // ─── tm_get_quote ────────────────────────────────────────────
  server.registerTool(
    "tm_get_quote",
    {
      title: "Get a trade quote",
      description: `Request a quote for buying or selling a token. Returns pricing info
and a quote_id that can be passed to tm_execute_trade within 60 seconds.

IMPORTANT: Always call this BEFORE tm_execute_trade. Inspect the quote
(price, fee, issues) and only execute if acceptable. This solves the
price uncertainty problem — you see the exact price you'll get.

Args:
  - side ("buy" | "sell"): Trade direction
  - token (string): Token symbol (SOL, ETH) or contract address
  - amount (string): Quantity as a decimal string
  - chain ("solana" | "base"): Blockchain network (default: solana)
  - qty_unit ("base" | "quote"): What the amount represents (default: "quote" for buy, "base" for sell)

Returns: {
  quote_id: string,       // Pass this to tm_execute_trade
  side, token, chain,
  you_pay: string,        // Amount + asset you send
  you_receive: string,    // Amount + asset you get
  fee: string,
  effective_price: string, // USDC per token
  issues: [],             // Any problems (e.g. insufficient balance)
  expires_in_seconds: 60
}`,
      inputSchema: {
        side: z.enum(["buy", "sell"]).describe("Buy or sell"),
        token: z.string().describe("Token symbol or contract address"),
        amount: z.string().describe("Quantity as decimal string"),
        chain: z.enum(["solana", "base"]).default("solana").describe("Chain"),
        qty_unit: z.enum(["base", "quote"]).optional()
          .describe("What amount represents. Default: 'quote' (USDC) for buy, 'base' (token) for sell"),
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async ({ side, token, amount, chain, qty_unit }) => {
      // Resolve symbol
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
        order_side: side,
        chain: resolvedChain,
        base_asset: baseAsset,
        quote_asset: getQuoteAsset(resolvedChain),
        qty: amount,
      });

      // Cache the quote so tm_execute_trade can use the same one
      cacheQuote(quote);

      // Compute effective price
      const qty = parseFloat(quote.qty);
      const qtyOut = parseFloat(quote.qty_out);
      const effectivePrice = side === "buy"
        ? (qty / qtyOut).toFixed(6)
        : (qtyOut / qty).toFixed(6);

      const output = {
        quote_id: quote.quote_id,
        side,
        token: token.toUpperCase(),
        chain: resolvedChain,
        you_pay: `${quote.qty} ${side === "buy" ? "USDC" : token.toUpperCase()}`,
        you_receive: `${quote.qty_out} ${side === "buy" ? token.toUpperCase() : "USDC"}`,
        fee: `${quote.fee} ${quote.fee_asset}`,
        effective_price: `${effectivePrice} USDC/${token.toUpperCase()}`,
        issues: quote.issues.map((i) => ({
          message: i.message,
          ...(i.balance ? { have: i.balance.actual, need: i.balance.expected } : {}),
        })),
        has_issues: quote.issues.length > 0,
        expires_in_seconds: 60,
      };

      return {
        content: [{ type: "text", text: JSON.stringify(output, null, 2) }],
        structuredContent: output,
      };
    }
  );

  // ─── tm_execute_trade ────────────────────────────────────────
  server.registerTool(
    "tm_execute_trade",
    {
      title: "Execute a quoted trade",
      description: `Execute a trade using a quote_id from tm_get_quote.

IMPORTANT: Only call this after inspecting the quote from tm_get_quote.
The quote must be less than 60 seconds old and have no issues.

This tool signs the quote payloads with the user's Turnkey API key
and submits the trade. It is irreversible.

Args:
  - quote_id (string): The quote_id from tm_get_quote

Returns: { success, order_id, tx_hash, explorer_url }`,
      inputSchema: {
        quote_id: z.string().describe("quote_id from tm_get_quote"),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async ({ quote_id }) => {
      const quote = getCachedQuote(quote_id);
      if (!quote) {
        return {
          isError: true,
          content: [{
            type: "text",
            text: "Quote expired or not found. Call tm_get_quote to get a fresh quote.",
          }],
        };
      }

      if (quote.issues.length > 0) {
        return {
          isError: true,
          content: [{
            type: "text",
            text: `Quote has issues: ${quote.issues.map((i) => i.message).join(", ")}. Cannot execute.`,
          }],
        };
      }

      if (!quote.payloads || quote.payloads.length === 0) {
        return {
          isError: true,
          content: [{ type: "text", text: "Quote has no payloads to sign." }],
        };
      }

      // Sign payloads
      const signer = getSigner();
      const signatures = signer.signAll(quote.payloads);

      // Execute
      const result = await api.executeTrade({
        quote_id: quote.quote_id,
        signatures,
        auth_type: "api_key",
      });

      // Clean up cache
      quoteCache.delete(quote_id);

      const chain = quote.base_asset.startsWith("0x") ? "base" : "solana";
      const explorerUrl = result.tx_hash
        ? txExplorerUrl(chain, result.tx_hash)
        : null;

      const output = {
        success: true,
        order_id: result.order_id ?? null,
        tx_hash: result.tx_hash ?? null,
        explorer_url: explorerUrl,
      };

      return {
        content: [{ type: "text", text: JSON.stringify(output, null, 2) }],
        structuredContent: output,
      };
    }
  );

  // ─── tm_prepare_transfer ─────────────────────────────────────
  server.registerTool(
    "tm_prepare_transfer",
    {
      title: "Prepare a token transfer",
      description: `Prepare a transfer to an external wallet address. Returns transfer
details and a transfer_id for execution with tm_execute_transfer.

Args:
  - to (string): Destination wallet address
  - token (string): Token symbol or contract address
  - amount (string): Quantity as decimal string
  - chain ("solana" | "base"): Chain (default: solana)
  - qty_unit ("base" | "quote"): Amount unit (default: base)

Returns: { transfer_id, to, token, amount, chain }`,
      inputSchema: {
        to: z.string().describe("Destination wallet address"),
        token: z.string().describe("Token symbol or address"),
        amount: z.string().describe("Amount to transfer"),
        chain: z.enum(["solana", "base"]).default("solana"),
        qty_unit: z.enum(["base", "quote"]).default("base"),
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async ({ to, token, amount, chain, qty_unit }) => {
      let asset = token;
      let resolvedChain = chain;

      if (isSymbol(token)) {
        const assets = await api.getAssets();
        const match = assets.find(
          (a) => a.symbol?.toLowerCase() === token.toLowerCase()
        );
        if (!match?.address) {
          return {
            isError: true,
            content: [{ type: "text", text: `Could not resolve symbol "${token}".` }],
          };
        }
        asset = match.address;
        if (match.chain) resolvedChain = match.chain.toLowerCase() as "solana" | "base";
      }

      const resp = await api.prepareTransfer({
        chain: resolvedChain,
        asset,
        to,
        qty: amount,
        qty_unit,
      });

      const output = {
        transfer_id: resp.transfer_id ?? null,
        to,
        token: token.toUpperCase(),
        amount,
        chain: resolvedChain,
        has_payloads: !!(resp.payloads && resp.payloads.length > 0),
      };

      return {
        content: [{ type: "text", text: JSON.stringify(output, null, 2) }],
        structuredContent: output,
      };
    }
  );

  // ─── tm_execute_transfer ─────────────────────────────────────
  server.registerTool(
    "tm_execute_transfer",
    {
      title: "Execute a prepared transfer",
      description: `Execute a transfer prepared with tm_prepare_transfer. Irreversible.

Args:
  - transfer_id (string): From tm_prepare_transfer

Returns: { success, tx_hash, chain, sent, fee, explorer_url }`,
      inputSchema: {
        transfer_id: z.string().describe("transfer_id from tm_prepare_transfer"),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async ({ transfer_id }) => {
      // For transfers, we need to re-prepare to get payloads
      // (The prepare response payloads aren't cached like quotes)
      // This is a limitation — in production, we'd cache prepare responses too
      return {
        isError: true,
        content: [{
          type: "text",
          text: "Transfer execution requires payload signing. " +
                "This is a scaffolded implementation — see TODO in source.",
        }],
      };
    }
  );
}
