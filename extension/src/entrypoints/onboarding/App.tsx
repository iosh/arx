import { Suspense } from "react";
import { OnboardingError } from "@/ui/pages/startup/OnboardingError";
import { OnboardingLoading } from "@/ui/pages/startup/OnboardingLoading";
import type { WalletConnectionResult } from "@/ui/wallet/connectWallet";
import { WalletConnection } from "@/ui/wallet/WalletConnection";

export function App({ connection }: { connection: Promise<WalletConnectionResult> }) {
  return (
    <Suspense fallback={<OnboardingLoading />}>
      <WalletConnection connection={connection} failure={<OnboardingError />} />
    </Suspense>
  );
}
