import { Suspense, useState } from "react";
import { OnboardingLayout } from "@/ui/components/OnboardingLayout";
import { CreateWalletFlow } from "@/ui/pages/create-wallet/CreateWalletFlow";
import { OnboardingError } from "@/ui/pages/startup/OnboardingError";
import { OnboardingLoading } from "@/ui/pages/startup/OnboardingLoading";
import { WelcomePage } from "@/ui/pages/welcome/WelcomePage";
import type { WalletConnectionResult } from "@/ui/wallet/connectWallet";
import { useWalletStatus } from "@/ui/wallet/useWalletStatus";
import { WalletConnection } from "@/ui/wallet/WalletConnection";

function Onboarding() {
  const status = useWalletStatus();
  const [screen, setScreen] = useState<"welcome" | "create">("welcome");

  if (status === "loading") return <OnboardingLoading />;
  if (status === "error") return <OnboardingError />;

  if (screen === "create") {
    return <CreateWalletFlow walletStatus={status} onExit={() => setScreen("welcome")} />;
  }
  if (status !== "uninitialized") {
    return <OnboardingLayout />;
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
