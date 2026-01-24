import { createFileRoute } from "@tanstack/react-router";
import { useEffect } from "react";
import { requireSetupComplete } from "@/ui/lib/routeGuards";
import { SetupCompleteScreen } from "@/ui/screens/onboarding/SetupCompleteScreen";
import { useOnboardingStore } from "@/ui/stores/onboardingStore";
export const Route = createFileRoute("/onboarding/complete")({
  beforeLoad: requireSetupComplete,
  component: SetupCompleteRoute,
});

function SetupCompleteRoute() {
  const clear = useOnboardingStore((s) => s.clear);

  useEffect(() => {
    clear();
  }, [clear]);

  // The user can't actually "Open wallet" via the button if it's already open in the extension context,
  // but if this is a full page tab, closing it is the logical action to "end" the onboarding.
  return <SetupCompleteScreen onOpenWallet={() => window.close()} />;
}
