import { createFileRoute } from "@tanstack/react-router";
import { useEffect } from "react";
import { mnemonicSession } from "@/ui/lib/mnemonicSession";
import { requireSetupComplete } from "@/ui/lib/routeGuards";
import { SetupCompleteScreen } from "@/ui/screens/onboarding/SetupCompleteScreen";
export const Route = createFileRoute("/onboarding/complete")({
  beforeLoad: requireSetupComplete,
  component: SetupCompleteRoute,
});

function SetupCompleteRoute() {
  useEffect(() => {
    mnemonicSession.clear();
  }, []);
  // The user can't actually "Open wallet" via the button if it's already open in the extension context,
  // but if this is a full page tab, closing it is the logical action to "end" the onboarding.
  return <SetupCompleteScreen onOpenWallet={() => window.close()} />;
}
