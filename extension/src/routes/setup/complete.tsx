import { createFileRoute, useRouter } from "@tanstack/react-router";
import { requireSetupComplete } from "@/ui/lib/routeGuards";
import { ROUTES } from "@/ui/lib/routes";
import { SetupCompleteScreen } from "@/ui/screens/onboarding/SetupCompleteScreen";
export const Route = createFileRoute("/setup/complete")({
  beforeLoad: requireSetupComplete,
  component: SetupCompleteRoute,
});

function SetupCompleteRoute() {
  const router = useRouter();
  return <SetupCompleteScreen onContinue={() => window.close()} />;
}
