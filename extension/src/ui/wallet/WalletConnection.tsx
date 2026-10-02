import type { WalletClient } from "@arx/wallet-api/client";
import { type ReactNode, use } from "react";
import type { WalletConnectionResult } from "./connectWallet";
import { useWalletActivity } from "./useWalletActivity";
import { WalletClientContext } from "./WalletClientContext";

function ConnectedWallet({ wallet, children }: { wallet: WalletClient; children?: ReactNode }) {
  useWalletActivity(wallet);
  return <WalletClientContext value={wallet}>{children}</WalletClientContext>;
}

export function WalletConnection({
  connection,
  failure,
  children,
}: Readonly<{
  connection: Promise<WalletConnectionResult>;
  failure: ReactNode;
  children?: ReactNode;
}>) {
  const result = use(connection);
  if (result.status === "error") return failure;
  return <ConnectedWallet wallet={result.wallet}>{children}</ConnectedWallet>;
}
