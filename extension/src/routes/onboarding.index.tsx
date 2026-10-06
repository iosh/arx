import { createFileRoute } from "@tanstack/react-router";
import { OpenWalletPage } from "@/ui/pages/open-wallet/OpenWalletPage";
import { WelcomePage } from "@/ui/pages/welcome/WelcomePage";
import { useSuspenseWalletStatus } from "@/ui/wallet/useWalletStatus";

export const Route = createFileRoute("/onboarding/")({
  component: OnboardingRoute,
});

function OnboardingRoute() {
  const status = useSuspenseWalletStatus();
  return status === "uninitialized" ? <WelcomePage /> : <OpenWalletPage />;
}
