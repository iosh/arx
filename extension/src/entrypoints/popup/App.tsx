import { RouterProvider } from "@tanstack/react-router";
import { Suspense, useEffect, useState } from "react";
import { createUiRouter } from "@/router";
import { PopupError } from "@/ui/components/PopupError";
import { PopupLoading } from "@/ui/components/PopupLoading";
import type { WalletConnectionResult } from "@/ui/wallet/connectWallet";
import { WalletConnection, WalletLockBoundary } from "@/ui/wallet/WalletConnection";
import { useWallet } from "@/ui/wallet/WalletContext";
import { OpenOnboarding } from "./OpenOnboarding";
import { Unlock } from "./Unlock";

const router = createUiRouter("popup");

function Popup() {
  const { status } = useWallet();
  const [focusInitialUnlock, setFocusInitialUnlock] = useState(true);

  useEffect(() => {
    setFocusInitialUnlock(false);
  }, []);

  return (
    <WalletLockBoundary>
      {status === "uninitialized" && <OpenOnboarding />}
      {status === "locked" && <Unlock focusPassword={focusInitialUnlock} />}
      {status === "unlocked" && <RouterProvider router={router} />}
    </WalletLockBoundary>
  );
}

export function App({ connection }: { connection: Promise<WalletConnectionResult> }) {
  return (
    <Suspense fallback={<PopupLoading />}>
      <WalletConnection connection={connection} loading={<PopupLoading />} failure={<PopupError />}>
        <Popup />
      </WalletConnection>
    </Suspense>
  );
}
