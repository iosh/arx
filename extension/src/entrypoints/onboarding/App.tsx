import { RouterProvider } from "@tanstack/react-router";
import { Suspense } from "react";
import { createUiRouter } from "@/router";
import { OnboardingErrorScreen } from "@/ui/components/OnboardingErrorScreen";
import { OnboardingLoadingScreen } from "@/ui/components/OnboardingLoadingScreen";
import { Toaster } from "@/ui/components/ui/sonner";
import type { WalletConnectionResult } from "@/ui/wallet/connection/connectWallet";
import { WalletConnection, WalletLockBoundary } from "@/ui/wallet/connection/WalletConnection";

const router = createUiRouter("onboarding");

export function App({ connection }: { connection: Promise<WalletConnectionResult> }) {
  return (
    <Suspense fallback={<OnboardingLoadingScreen />}>
      <WalletConnection
        connection={connection}
        loading={<OnboardingLoadingScreen />}
        failure={<OnboardingErrorScreen />}
      >
        <WalletLockBoundary>
          <RouterProvider router={router} />
          <Toaster />
        </WalletLockBoundary>
      </WalletConnection>
    </Suspense>
  );
}
