import { type ReactNode, use } from "react";
import type { WalletConnectionResult } from "./connectWallet";
import { WalletClientContext } from "./WalletClientContext";

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
  return <WalletClientContext value={result.wallet}>{children}</WalletClientContext>;
}
