import { RouterProvider } from "@tanstack/react-router";
import { Suspense, useEffect, useState } from "react";
import { createUiRouter } from "@/router";
import { PopupErrorScreen } from "@/ui/components/PopupErrorScreen";
import { PopupLoadingScreen } from "@/ui/components/PopupLoadingScreen";
import { Toaster } from "@/ui/components/ui/sonner";
import type { WalletConnectionResult } from "@/ui/wallet/connection/connectWallet";
import { WalletConnection, WalletLockBoundary } from "@/ui/wallet/connection/WalletConnection";
import { useWallet } from "@/ui/wallet/connection/WalletContext";
import { OnboardingLauncher } from "./OnboardingLauncher";
import { UnlockScreen } from "./UnlockScreen";

const router = createUiRouter("popup");

function Popup() {
  const { status } = useWallet();
  const [focusInitialUnlock, setFocusInitialUnlock] = useState(true);

  useEffect(() => {
    setFocusInitialUnlock(false);
  }, []);

  return (
    <WalletLockBoundary>
      {status === "uninitialized" && <OnboardingLauncher />}
      {status === "locked" && <UnlockScreen focusPassword={focusInitialUnlock} />}
      {status === "unlocked" && <RouterProvider router={router} />}
      <Toaster />
    </WalletLockBoundary>
  );
}

export function App({ connection }: { connection: Promise<WalletConnectionResult> }) {
  return (
    <Suspense fallback={<PopupLoadingScreen />}>
      <WalletConnection connection={connection} loading={<PopupLoadingScreen />} failure={<PopupErrorScreen />}>
        <Popup />
      </WalletConnection>
    </Suspense>
  );
}
