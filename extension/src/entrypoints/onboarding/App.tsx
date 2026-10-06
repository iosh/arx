import { RouterProvider } from "@tanstack/react-router";
import { Suspense } from "react";
import { createUiRouter } from "@/router";
import { OnboardingError } from "@/ui/pages/startup/OnboardingError";
import { OnboardingLoading } from "@/ui/pages/startup/OnboardingLoading";
import type { WalletConnectionResult } from "@/ui/wallet/connectWallet";
import { useWalletActivity } from "@/ui/wallet/useWalletActivity";
import { useWalletStatus } from "@/ui/wallet/useWalletStatus";
import { useWalletClient } from "@/ui/wallet/WalletClientContext";
import { WalletConnection } from "@/ui/wallet/WalletConnection";

const router = createUiRouter("onboarding");

export function App({ connection }: { connection: Promise<WalletConnectionResult> }) {
  return (
    <Suspense fallback={<OnboardingLoading />}>
      <WalletConnection connection={connection} failure={<OnboardingError />}>
        <Onboarding />
      </WalletConnection>
    </Suspense>
  );
}

function Onboarding() {
  const wallet = useWalletClient();
  const statusQuery = useWalletStatus();
  useWalletActivity(wallet, statusQuery.isSuccess && statusQuery.data === "unlocked");

  if (statusQuery.isPending) return <OnboardingLoading />;
  if (statusQuery.isError) return <OnboardingError />;
  return <RouterProvider router={router} />;
}
