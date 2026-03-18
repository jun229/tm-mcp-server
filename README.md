# truemarkets-mcp-server

MCP (Model Context Protocol) server for True Markets. Gives AI agents native trading capabilities without shelling out to bash.

## Why this exists

The True Markets CLI (`tm`) works with agents through bash skills — the agent runs `tm buy SOL 50 -o json --force` and parses stdout. This works, but has fundamental problems:

1. **Two-quote problem**: `--dry-run` and `--force` fetch separate quotes. The agent decides based on quote A but executes at quote B's price.
2. **No slippage protection**: No mechanism to reject execution if price moves.
3. **Process overhead**: Every command spawns a new process, re-reads credentials, re-establishes HTTP connections.
4. **Fragile parsing**: Agent must parse JSON from stdout mixed with stderr warnings.

The MCP server solves all of these:

- **Quote caching**: `tm_get_quote` returns a `quote_id` cached for 60 seconds. `tm_execute_trade` uses the *same* quote — no price surprise.
- **Structured responses**: Tools return typed JSON via MCP's `structuredContent`, no stdout parsing.
- **Persistent auth**: Credentials loaded once on startup, tokens refreshed automatically.
- **Native tool calls**: Agents call tools directly instead of composing bash strings.

## Tools

### Read-only

| Tool | Description |
|------|-------------|
| `tm_get_price` | Get token price in USDC (no API key needed) |
| `tm_get_balances` | Get token balances across chains |
| `tm_list_assets` | List available tokens |
| `tm_get_profile` | Get account email and wallet addresses |

### Trading

| Tool | Description | Destructive |
|------|-------------|-------------|
| `tm_get_quote` | Get a trade quote (cached 60s) | No |
| `tm_execute_trade` | Execute a cached quote | **Yes** |
| `tm_prepare_transfer` | Prepare outbound transfer | No |
| `tm_execute_transfer` | Execute a prepared transfer | **Yes** |

### Agent workflow

```
1. tm_get_balances          → check available funds
2. tm_get_quote(buy, SOL, 50) → inspect price, fee, issues
3. [agent decides: price acceptable? issues empty?]
4. tm_execute_trade(quote_id) → execute the SAME quote
```

Compare to the CLI flow where step 4 fetches a *new* quote silently.

## Setup

### Prerequisites

- Node.js 18+
- Existing True Markets account (`tm signup` / `tm login` via the CLI)
- API key configured (`tm config set api_key <key>`)

The MCP server reads credentials from `~/.config/truemarkets/` — the same location the CLI uses. No separate auth setup needed.

### Install

```bash
npm install -g truemarkets-mcp-server
```

### Configure your agent

#### Claude Code / claude.ai

Add to your MCP config (`.claude/mcp.json` or via settings):

```json
{
  "mcpServers": {
    "truemarkets": {
      "command": "truemarkets-mcp-server",
      "args": []
    }
  }
}
```

#### Cursor

Add to `.cursor/mcp.json`:

```json
{
  "mcpServers": {
    "truemarkets": {
      "command": "npx",
      "args": ["truemarkets-mcp-server"]
    }
  }
}
```

### Environment variables

| Variable | Description |
|----------|-------------|
| `TM_AUTH_TOKEN` | Override stored auth token |
| `TM_API_KEY` | Override stored API key |

## Development

```bash
git clone https://github.com/true-markets/mcp-server.git
cd mcp-server
npm install
npm run build
npm start
```

Test with the MCP inspector:

```bash
npx @modelcontextprotocol/inspector node dist/index.js
```

## Architecture

```
src/
├── index.ts              # Entry point, stdio transport
├── constants.ts          # API host, paths, version
├── types.ts              # Shared types and helpers
├── services/
│   ├── auth.ts           # Token/key management (reads ~/.config/truemarkets/)
│   ├── api-client.ts     # DeFi Gateway HTTP client
│   └── signer.ts         # Turnkey P256 payload signing
└── tools/
    ├── read.ts           # Read-only tools (price, balances, assets, profile)
    └── trade.ts          # Trading tools (quote, execute, transfer)
```

## License

MIT
