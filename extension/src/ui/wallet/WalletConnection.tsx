import type { WalletClient } from "@arx/wallet-api/client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Fragment, type ReactNode, use, useState } from "react";
import type { WalletConnectionResult } from "./connectWallet";
import { useWalletActivity } from "./useWalletActivity";
import { useWalletEvents } from "./useWalletEvents";
import { useWallet, WalletContext } from "./WalletContext";

const walletStatusQueryKey = ["walletStatus"] as const;

type WalletContentProps = Readonly<{
  loading: ReactNode;
  failure: ReactNode;
  children: ReactNode;
}>;

export function WalletConnection({
  connection,
  loading,
  failure,
  children,
}: WalletContentProps & { connection: Promise<WalletConnectionResult> }) {
  const result = use(connection);
  if (result.status === "error") return failure;
  return (
    <WalletProvider wallet={result.wallet} loading={loading} failure={failure}>
      {children}
    </WalletProvider>
  );
}

function WalletProvider({ wallet, loading, failure, children }: WalletContentProps & { wallet: WalletClient }) {
  const queryClient = useQueryClient();

  useWalletEvents(wallet, "walletStatusChanged", (event) => {
    // A committed status event takes precedence over an earlier query.
    void queryClient.cancelQueries({ queryKey: walletStatusQueryKey, exact: true });
    queryClient.setQueryData(walletStatusQueryKey, event.status);
  });

  const statusQuery = useQuery({
    queryKey: walletStatusQueryKey,
    queryFn: () => wallet.getStatus(),
    networkMode: "always",
    retry: false,
    refetchOnWindowFocus: false,
    staleTime: Infinity,
    gcTime: 0,
  });
  const status = statusQuery.data;
  useWalletActivity(wallet, status === "unlocked");

  if (status === undefined) return statusQuery.isError ? failure : loading;
  return <WalletContext value={{ client: wallet, status }}>{children}</WalletContext>;
}

export function WalletLockBoundary({ children }: { children: ReactNode }) {
  const { client: wallet } = useWallet();
  const [lockCount, setLockCount] = useState(0);

  useWalletEvents(wallet, "walletStatusChanged", (event) => {
    // Locking discards page state; unlocking must preserve the pending password submission.
    if (event.status === "locked") setLockCount((current) => current + 1);
  });

  return <Fragment key={lockCount}>{children}</Fragment>;
}
