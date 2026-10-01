import type { WalletClient } from "@arx/wallet-api/client";
import { createContext, use } from "react";

export const WalletClientContext = createContext<WalletClient | null>(null);

export function useWalletClient(): WalletClient {
  const wallet = use(WalletClientContext);
  if (!wallet) throw new Error("WalletConnection is missing.");
  return wallet;
}
