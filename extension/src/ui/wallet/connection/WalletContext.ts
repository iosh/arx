import type { WalletStatus } from "@arx/core/wallet";
import type { WalletClient } from "@arx/wallet-api/client";
import { createContext, use } from "react";

type WalletContextValue = Readonly<{
  client: WalletClient;
  status: WalletStatus;
}>;

export const WalletContext = createContext<WalletContextValue | null>(null);

export function useWallet(): WalletContextValue {
  const wallet = use(WalletContext);
  if (wallet === null) throw new Error("WalletConnection is missing.");
  return wallet;
}
