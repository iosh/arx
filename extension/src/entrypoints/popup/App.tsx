import { Suspense } from "react";
import { PopupError } from "@/ui/pages/startup/PopupError";
import { PopupLoading } from "@/ui/pages/startup/PopupLoading";
import type { WalletConnectionResult } from "@/ui/wallet/connectWallet";
import { WalletConnection } from "@/ui/wallet/WalletConnection";

export function App({ connection }: { connection: Promise<WalletConnectionResult> }) {
  return (
    <Suspense fallback={<PopupLoading />}>
      <WalletConnection connection={connection} failure={<PopupError />} />
    </Suspense>
  );
}
