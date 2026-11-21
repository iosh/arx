import type { WalletClient } from "@arx/wallet-api/client";
import { Fragment, type ReactNode, use, useState } from "react";
import { flushSync } from "react-dom";
import { toast } from "sonner";
import { useHomeNetworkFilter } from "@/ui/pages/home/useHomeNetworkFilter";
import type { WalletConnectionResult } from "./connectWallet";
import { useWalletActivity } from "./useWalletActivity";
import { useWalletDataSync } from "./useWalletDataSync";
import { useWalletEvents } from "./useWalletEvents";
import { useWalletStatus } from "./useWalletStatus";
import { useWallet, WalletContext } from "./WalletContext";

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
  const { data: status, isError } = useWalletStatus(wallet);
  useWalletDataSync(wallet);
  useWalletActivity(wallet, status === "unlocked");

  if (status === undefined) return isError ? failure : loading;
  return <WalletContext value={{ client: wallet, status }}>{children}</WalletContext>;
}

export function WalletLockBoundary({ children }: { children: ReactNode }) {
  const { client: wallet } = useWallet();
  const [lockCount, setLockCount] = useState(0);
  const setChainRef = useHomeNetworkFilter((state) => state.setChainRef);

  useWalletEvents(wallet, "walletStatusChanged", (event) => {
    // Locking discards page state; unlocking must preserve the pending password submission.
    if (event.status === "locked") {
      // Reset before a following channel response can run the old page's callbacks.
      flushSync(() => {
        setChainRef(null);
        // Sonner replays active notifications when its container remounts.
        toast.dismiss();
        setLockCount((current) => current + 1);
      });
    }
  });

  return <Fragment key={lockCount}>{children}</Fragment>;
}
