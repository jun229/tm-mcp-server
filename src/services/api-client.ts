import { API_HOST, API_VERSION } from "../constants.js";
import type { AuthManager } from "./auth.js";

export interface QuoteRequest {
  order_side: "buy" | "sell";
  chain: string;
  base_asset: string;
  quote_asset: string;
  qty: string;
}

export interface QuoteResponse {
  base_asset: string;
  quote_asset: string;
  order_side: string;
  qty: string;
  qty_out: string;
  fee: string;
  fee_asset: string;
  quote_id: string;
  payloads: Array<{ payload: string }>;
  issues: Array<{ message: string; balance?: { actual: string; expected: string } }>;
}

export interface TradeRequest {
  quote_id: string;
  signatures: string[];
  auth_type: "api_key";
}

export interface TradeResponse {
  order_id?: string;
  tx_hash?: string;
}

export interface TransferPrepareRequest {
  chain: string;
  asset: string;
  to: string;
  qty: string;
  qty_unit: "base" | "quote";
}

export interface TransferPrepareResponse {
  transfer_id?: string;
  payloads?: Array<{ payload: string }>;
}

export interface TransferExecuteRequest {
  transfer_id: string;
  signatures: string[];
  auth_type: "api_key";
}

export interface TransferExecuteResponse {
  tx_hash?: string;
  chain?: string;
  sent?: string;
  fee?: string;
}

export interface Asset {
  name?: string;
  symbol?: string;
  chain?: string;
  address?: string;
  decimals?: number;
}

export interface Balance {
  name?: string;
  symbol?: string;
  chain?: string;
  asset?: string;
  balance?: string;
  decimals?: number;
}

export interface Profile {
  email?: string;
  wallets?: Array<{ chain?: string; address?: string }>;
}

export class ApiClient {
  constructor(private auth: AuthManager) {}

  private async request<T>(
    path: string,
    method: "GET" | "POST",
    body?: unknown,
    requireAuth = true
  ): Promise<T> {
    const url = new URL(path, API_HOST);
    url.searchParams.set("version", API_VERSION);

    const headers: Record<string, string> = {
      "User-Agent": "truemarkets-mcp-server/0.1.0",
      "Content-Type": "application/json",
    };

    if (requireAuth) {
      const token = await this.auth.getAccessToken();
      headers["Authorization"] = `Bearer ${token}`;
    }

    const resp = await fetch(url.toString(), {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });

    if (resp.status === 401) {
      throw new Error("Unauthorized. Run 'tm login' to re-authenticate.");
    }

    if (!resp.ok) {
      const text = await resp.text();
      throw new Error(`API error (${resp.status}): ${text}`);
    }

    return (await resp.json()) as T;
  }

  async getAssets(): Promise<Asset[]> {
    const params = new URLSearchParams({ evm: "true", version: API_VERSION });
    const url = `/v1/defi/core/assets?${params}`;
    return this.request<Asset[]>(url, "GET", undefined, false);
  }

  async getBalances(): Promise<{ balances: Balance[] }> {
    return this.request<{ balances: Balance[] }>(
      "/v1/defi/core/balances?evm=true",
      "GET"
    );
  }

  async getProfile(): Promise<Profile> {
    return this.request<Profile>("/v1/defi/core/profile", "GET");
  }

  async createQuote(req: QuoteRequest): Promise<QuoteResponse> {
    return this.request<QuoteResponse>("/v1/defi/core/quote", "POST", req);
  }

  async executeTrade(req: TradeRequest): Promise<TradeResponse> {
    return this.request<TradeResponse>("/v1/defi/core/trade", "POST", req);
  }

  async prepareTransfer(req: TransferPrepareRequest): Promise<TransferPrepareResponse> {
    return this.request<TransferPrepareResponse>(
      "/v1/defi/core/transfer/prepare",
      "POST",
      req
    );
  }

  async executeTransfer(req: TransferExecuteRequest): Promise<TransferExecuteResponse> {
    return this.request<TransferExecuteResponse>(
      "/v1/defi/core/transfer/execute",
      "POST",
      req
    );
  }
}
