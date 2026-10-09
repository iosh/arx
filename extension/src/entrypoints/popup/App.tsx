import { RouterProvider } from "@tanstack/react-router";
import { Suspense, useEffect, useRef, useState } from "react";
import browser from "webextension-polyfill";
import { createUiRouter } from "@/router";
import { PopupError } from "@/ui/pages/error/PopupError";
import { PopupLoading } from "@/ui/pages/startup/PopupLoading";
import { UnlockPage } from "@/ui/pages/unlock/UnlockPage";
import type { WalletConnectionResult } from "@/ui/wallet/connectWallet";
import { WalletConnection, WalletLockBoundary } from "@/ui/wallet/WalletConnection";
import { useWallet } from "@/ui/wallet/WalletContext";

const router = createUiRouter("popup");

export function App({ connection }: { connection: Promise<WalletConnectionResult> }) {
  return (
    <Suspense fallback={<PopupLoading />}>
      <WalletConnection connection={connection} loading={<PopupLoading />} failure={<PopupError />}>
        <Popup />
      </WalletConnection>
    </Suspense>
  );
}

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

function OpenOnboarding() {
  const requested = useRef(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (requested.current) return;
    requested.current = true;
    void browser.tabs.create({ url: browser.runtime.getURL("onboarding.html") }).then(
      () => window.close(),
      () => setFailed(true),
    );
  }, []);

  return failed ? <PopupError /> : <PopupLoading />;
}
