export const SOLANA_USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
export const BASE_USDC = "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913";

export type Chain = "solana" | "base";
export type OrderSide = "buy" | "sell";
export type QtyUnit = "base" | "quote";

export function getQuoteAsset(chain: Chain): string {
  return chain === "base" ? BASE_USDC : SOLANA_USDC;
}

export function isSymbol(input: string): boolean {
  return input.length > 0 && input.length <= 10;
}

export function txExplorerUrl(chain: string, hash: string): string {
  if (chain === "base") return `https://basescan.org/tx/${hash}`;
  return `https://solscan.io/tx/${hash}`;
}
