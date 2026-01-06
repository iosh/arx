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
  return <SetupCompleteScreen onOpenWallet={() => window.close()} />;
}
