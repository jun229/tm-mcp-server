# CLAUDE.md

## Project overview

MCP (Model Context Protocol) server for True Markets. Gives AI agents native crypto trading tools instead of shelling out to `tm` CLI via bash.

## Architecture

- **Transport**: stdio (agents spawn this as a subprocess)
- **Auth**: Reads credentials from `~/.config/truemarkets/` (shared with the `tm` CLI)
- **API**: Wraps the True Markets DeFi Gateway at `api.truemarkets.co`
- **Signing**: Turnkey P256 ECDSA via `src/services/signer.ts` (needs `@turnkey/api-key-stamper` for production)

## Key design decision: quote caching

The CLI's `--dry-run` and `--force` fetch separate quotes, so agents decide on one price but execute at another. This server caches quotes for 60 seconds — `tm_get_quote` returns a `quote_id`, and `tm_execute_trade` signs and submits the *same* cached quote.

## Tools (8 total)

**Read-only**: `tm_get_price`, `tm_get_balances`, `tm_list_assets`, `tm_get_profile`
**Trading**: `tm_get_quote`, `tm_execute_trade`, `tm_prepare_transfer`, `tm_execute_transfer`

## Build and test

```bash
npm install
npm run build          # tsc → dist/
npm start              # runs dist/index.js (stdio transport)
```

Verify MCP handshake:
```bash
echo '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-03-26","capabilities":{},"clientInfo":{"name":"test","version":"0.1"}}}' | node dist/index.js 2>/dev/null
```

## File structure

```
src/
├── index.ts              # Entry point, McpServer + stdio transport
├── constants.ts          # API_HOST, API_VERSION, config paths
├── types.ts              # Chain, OrderSide, USDC addresses, helpers
├── services/
│   ├── auth.ts           # TokenManager — loads JWT + API key from disk
│   ├── api-client.ts     # HTTP client for all 8 DeFi Gateway endpoints
│   └── signer.ts         # Turnkey P256 payload signing (TODO: use @turnkey/api-key-stamper)
└── tools/
    ├── read.ts           # Read-only tools (price, balances, assets, profile)
    └── trade.ts          # Trading tools (quote, execute, transfer) + quote cache
```

## Conventions

- Tool names use `tm_` prefix with snake_case (`tm_get_price`, not `getPrice`)
- All tools return `{ content: [{ type: "text", text: JSON.stringify(...) }], structuredContent: ... }`
- Destructive tools (execute trade/transfer) have `destructiveHint: true` annotation
- Errors return `{ isError: true, content: [{ type: "text", text: "..." }] }` with actionable messages
- Zod schemas for all tool inputs — no raw `any` types
- Logs go to stderr (stdout is reserved for MCP JSON-RPC protocol)

## TODOs

- [ ] Replace signer with `@turnkey/api-key-stamper` for proper Turnkey stamp envelope format
- [ ] Add transfer prepare-response cache (same pattern as quote cache in `trade.ts`)
- [ ] Add `tm_execute_transfer` implementation (currently returns scaffolded error)
- [ ] Add `--max-slippage` param to `tm_execute_trade` (compare cached quote price vs threshold)
- [ ] Test against live True Markets API with funded account
- [ ] Add MCP Inspector test scripts