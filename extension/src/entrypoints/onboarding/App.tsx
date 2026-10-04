import { Suspense, useState } from "react";
import browser from "webextension-polyfill";
import { CreateWalletFlow } from "@/ui/pages/create-wallet/CreateWalletFlow";
import { OpenWalletPage } from "@/ui/pages/open-wallet/OpenWalletPage";
import { OnboardingError } from "@/ui/pages/startup/OnboardingError";
import { OnboardingLoading } from "@/ui/pages/startup/OnboardingLoading";
import { WelcomePage } from "@/ui/pages/welcome/WelcomePage";
import type { WalletConnectionResult } from "@/ui/wallet/connectWallet";
import { useWalletActivity } from "@/ui/wallet/useWalletActivity";
import { useWalletStatus } from "@/ui/wallet/useWalletStatus";
import { useWalletClient } from "@/ui/wallet/WalletClientContext";
import { WalletConnection } from "@/ui/wallet/WalletConnection";

async function openWallet() {
  try {
    await browser.action.openPopup();
  } catch {
    // The page also provides the toolbar path when the browser cannot open its popup.
  }
}

function Onboarding() {
  const wallet = useWalletClient();
  const statusQuery = useWalletStatus();
  const [screen, setScreen] = useState<"welcome" | "create">("welcome");
  useWalletActivity(wallet, statusQuery.isSuccess && statusQuery.data === "unlocked");

  if (statusQuery.isPending) return <OnboardingLoading />;
  if (statusQuery.isError) return <OnboardingError />;

  const status = statusQuery.data;
  if (screen === "create") {
    return (
      <CreateWalletFlow
        walletStatus={status}
        onExit={() => setScreen("welcome")}
        onComplete={() => {
          setScreen("welcome");
          void openWallet();
        }}
      />
    );
  }
  if (status !== "uninitialized") {
    return <OpenWalletPage onOpen={openWallet} />;
  }
  return <WelcomePage onCreate={() => setScreen("create")} />;
}

export function App({ connection }: { connection: Promise<WalletConnectionResult> }) {
  return (
    <Suspense fallback={<OnboardingLoading />}>
      <WalletConnection connection={connection} failure={<OnboardingError />}>
        <Onboarding />
      </WalletConnection>
    </Suspense>
  );
}
