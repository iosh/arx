import { createFileRoute } from "@tanstack/react-router";
import { requireSetupComplete } from "@/ui/lib/routeGuards";

import { SetupCompleteScreen } from "@/ui/screens/onboarding/SetupCompleteScreen";
export const Route = createFileRoute("/setup/complete")({
  beforeLoad: requireSetupComplete,
  component: SetupCompleteRoute,
});

function SetupCompleteRoute() {
  return <SetupCompleteScreen onOpenWallet={() => window.close()} />;
}
