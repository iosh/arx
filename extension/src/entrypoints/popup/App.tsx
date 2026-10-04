import { Suspense, useEffect, useRef, useState } from "react";
import browser from "webextension-polyfill";
import { PopupError } from "@/ui/pages/startup/PopupError";
import { PopupLoading } from "@/ui/pages/startup/PopupLoading";
import { UnlockPage } from "@/ui/pages/unlock/UnlockPage";
import { WalletHomePage } from "@/ui/pages/wallet-home/WalletHomePage";
import type { WalletConnectionResult } from "@/ui/wallet/connectWallet";
import { useWalletActivity } from "@/ui/wallet/useWalletActivity";
import { useWalletStatus } from "@/ui/wallet/useWalletStatus";
import { useWalletClient } from "@/ui/wallet/WalletClientContext";
import { WalletConnection } from "@/ui/wallet/WalletConnection";

function OpenOnboarding() {
  const opened = useRef(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (opened.current) return;
    opened.current = true;
    void browser.tabs.create({ url: browser.runtime.getURL("onboarding.html") }).then(
      () => window.close(),
      () => setFailed(true),
    );
  }, []);

  return failed ? <PopupError /> : <PopupLoading />;
}

function Popup() {
  const wallet = useWalletClient();
  const statusQuery = useWalletStatus();
  const [initialOpen, setInitialOpen] = useState(true);
  useWalletActivity(wallet, statusQuery.isSuccess && statusQuery.data === "unlocked");

  useEffect(() => {
    if (!statusQuery.isPending) setInitialOpen(false);
  }, [statusQuery.isPending]);

  if (statusQuery.isPending) return <PopupLoading />;
  if (statusQuery.isError) return <PopupError />;
  const status = statusQuery.data;
  if (status === "uninitialized") return <OpenOnboarding />;
  if (status === "locked") return <UnlockPage focusPassword={initialOpen} />;
  return <WalletHomePage />;
}

export function App({ connection }: { connection: Promise<WalletConnectionResult> }) {
  return (
    <Suspense fallback={<PopupLoading />}>
      <WalletConnection connection={connection} failure={<PopupError />}>
        <Popup />
      </WalletConnection>
    </Suspense>
  );
}
