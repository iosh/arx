import { type ReactNode, use, useEffect } from "react";
import type { WalletConnectionResult } from "./connectWallet";
import { reportUserActivity } from "./reportUserActivity";
import { WalletClientContext } from "./WalletClientContext";

function ConnectedWallet({
  connection,
  children,
}: {
  connection: Extract<WalletConnectionResult, { status: "ready" }>;
  children?: ReactNode;
}) {
  useEffect(() => reportUserActivity(connection.port), [connection.port]);
  return <WalletClientContext value={connection.wallet}>{children}</WalletClientContext>;
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
  return <ConnectedWallet connection={result}>{children}</ConnectedWallet>;
}
