import { RouterProvider } from "@tanstack/react-router";
import { Suspense, useEffect, useState } from "react";
import { createUiRouter } from "@/router";
import { PopupError } from "@/ui/pages/error/PopupError";
import { OpenOnboarding } from "@/ui/pages/open-onboarding/OpenOnboarding";
import { PopupLoading } from "@/ui/pages/startup/PopupLoading";
import { UnlockPage } from "@/ui/pages/unlock/UnlockPage";
import type { WalletConnectionResult } from "@/ui/wallet/connectWallet";
import { WalletConnection, WalletLockBoundary } from "@/ui/wallet/WalletConnection";
import { useWallet } from "@/ui/wallet/WalletContext";

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
      {status === "locked" && <UnlockPage focusPassword={focusInitialUnlock} />}
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
