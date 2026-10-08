import { RouterProvider } from "@tanstack/react-router";
import { Suspense } from "react";
import { createUiRouter } from "@/router";
import { OnboardingError } from "@/ui/pages/startup/OnboardingError";
import { OnboardingLoading } from "@/ui/pages/startup/OnboardingLoading";
import type { WalletConnectionResult } from "@/ui/wallet/connectWallet";
import { WalletConnection, WalletLockBoundary } from "@/ui/wallet/WalletConnection";

const router = createUiRouter("onboarding");

export function App({ connection }: { connection: Promise<WalletConnectionResult> }) {
  return (
    <Suspense fallback={<OnboardingLoading />}>
      <WalletConnection connection={connection} loading={<OnboardingLoading />} failure={<OnboardingError />}>
        <WalletLockBoundary>
          <RouterProvider router={router} />
        </WalletLockBoundary>
      </WalletConnection>
    </Suspense>
  );
}
