import { createFileRoute } from "@tanstack/react-router";
import { OpenWalletPage } from "@/ui/pages/open-wallet/OpenWalletPage";
import { WelcomePage } from "@/ui/pages/welcome/WelcomePage";
import { useWallet } from "@/ui/wallet/WalletContext";

export const Route = createFileRoute("/onboarding/")({
  component: OnboardingRoute,
});

function OnboardingRoute() {
  const { status } = useWallet();
  return status === "uninitialized" ? <WelcomePage /> : <OpenWalletPage />;
}
