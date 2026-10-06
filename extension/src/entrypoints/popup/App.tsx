import { RouterProvider } from "@tanstack/react-router";
import { Suspense, useEffect, useRef, useState } from "react";
import browser from "webextension-polyfill";
import { createUiRouter } from "@/router";
import { PopupError } from "@/ui/pages/startup/PopupError";
import { PopupLoading } from "@/ui/pages/startup/PopupLoading";
import { UnlockPage } from "@/ui/pages/unlock/UnlockPage";
import type { WalletConnectionResult } from "@/ui/wallet/connectWallet";
import { useWalletActivity } from "@/ui/wallet/useWalletActivity";
import { useWalletStatus } from "@/ui/wallet/useWalletStatus";
import { useWalletClient } from "@/ui/wallet/WalletClientContext";
import { WalletConnection } from "@/ui/wallet/WalletConnection";

const router = createUiRouter("popup");

export function App({ connection }: { connection: Promise<WalletConnectionResult> }) {
  return (
    <Suspense fallback={<PopupLoading />}>
      <WalletConnection connection={connection} failure={<PopupError />}>
        <Popup />
      </WalletConnection>
    </Suspense>
  );
}

function Popup() {
  const wallet = useWalletClient();
  const statusQuery = useWalletStatus();
  const [focusInitialUnlock, setFocusInitialUnlock] = useState(true);
  useWalletActivity(wallet, statusQuery.isSuccess && statusQuery.data === "unlocked");

  useEffect(() => {
    if (!statusQuery.isPending) setFocusInitialUnlock(false);
  }, [statusQuery.isPending]);

  if (statusQuery.isPending) return <PopupLoading />;
  if (statusQuery.isError) return <PopupError />;
  if (statusQuery.data === "uninitialized") return <OpenOnboarding />;
  if (statusQuery.data === "locked") return <UnlockPage focusPassword={focusInitialUnlock} />;
  return <RouterProvider router={router} />;
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
