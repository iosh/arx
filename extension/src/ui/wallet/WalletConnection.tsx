import { useQueryClient } from "@tanstack/react-query";
import { type ReactNode, use, useEffect } from "react";
import type { WalletConnectionResult } from "./connectWallet";
import { walletStatusQueryKey } from "./useWalletStatus";
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
  const queryClient = useQueryClient();

  useEffect(() => {
    if (result.status !== "ready") return;
    return result.wallet.subscribe((event) => {
      if (event.type !== "walletStatusChanged") return;
      // A committed status event takes precedence over an earlier query.
      void queryClient.cancelQueries({ queryKey: walletStatusQueryKey, exact: true });
      queryClient.setQueryData(walletStatusQueryKey, event.status);
    });
  }, [result, queryClient]);

  if (result.status === "error") return failure;
  return <WalletClientContext value={result.wallet}>{children}</WalletClientContext>;
}
