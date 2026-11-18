import type { AssetId } from "./assetId.js";

export type AssetBalance = Readonly<{
  assetId: AssetId;
  name: string;
  symbol: string;
  decimals: number;
  /** Unsigned base-unit integer encoded in decimal for transport. */
  balance: string;
}>;
