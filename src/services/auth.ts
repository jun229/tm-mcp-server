import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { CREDENTIALS_PATH, KEYS_DIR, API_HOST } from "../constants.js";

export interface TokenData {
  access_token: string;
  refresh_token: string;
  expires_at: string;
  email: string;
}

export class AuthManager {
  private tokens: TokenData | null = null;
  private apiKey: string | null = null;

  constructor() {
    this.loadCredentials();
  }

  private loadCredentials(): void {
    // Load JWT tokens
    if (existsSync(CREDENTIALS_PATH)) {
      try {
        const raw = readFileSync(CREDENTIALS_PATH, "utf-8");
        this.tokens = JSON.parse(raw) as TokenData;
      } catch {
        this.tokens = null;
      }
    }

    // Load API key (per-user from keys/{email})
    if (process.env.TM_API_KEY) {
      this.apiKey = process.env.TM_API_KEY;
    } else if (this.tokens?.email) {
      const keyPath = join(KEYS_DIR, this.tokens.email);
      if (existsSync(keyPath)) {
        try {
          this.apiKey = readFileSync(keyPath, "utf-8").trim();
        } catch {
          this.apiKey = null;
        }
      }
    }
  }

  async getAccessToken(): Promise<string> {
    // Check env override first
    if (process.env.TM_AUTH_TOKEN) {
      return process.env.TM_AUTH_TOKEN;
    }

    if (!this.tokens) {
      throw new Error(
        "Not logged in. Run 'tm login' or 'tm signup' to authenticate, " +
        "or set TM_AUTH_TOKEN environment variable."
      );
    }

    // Check if token needs refresh (5 min buffer)
    const expiresAt = new Date(this.tokens.expires_at).getTime();
    const buffer = 5 * 60 * 1000;
    if (Date.now() + buffer < expiresAt) {
      return this.tokens.access_token;
    }

    // Refresh
    return this.refreshToken();
  }

  private async refreshToken(): Promise<string> {
    if (!this.tokens) throw new Error("No tokens to refresh");

    const resp = await fetch(`${API_HOST}/v1/auth/token/refresh`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ refresh_token: this.tokens.refresh_token }),
    });

    if (!resp.ok) {
      throw new Error(`Token refresh failed (${resp.status}). Run 'tm login' to re-authenticate.`);
    }

    const data = (await resp.json()) as {
      access_token: string;
      refresh_token: string;
      expires_in: string;
    };

    this.tokens = {
      ...this.tokens,
      access_token: data.access_token,
      refresh_token: data.refresh_token,
      expires_at: data.expires_in,
    };

    return data.access_token;
  }

  getApiKey(): string {
    if (!this.apiKey) {
      throw new Error(
        "API key not found. Run 'tm config set api_key <key>' " +
        "or set TM_API_KEY environment variable."
      );
    }
    return this.apiKey;
  }

  getEmail(): string | null {
    return this.tokens?.email ?? null;
  }

  isAuthenticated(): boolean {
    return !!(this.tokens || process.env.TM_AUTH_TOKEN);
  }
}
