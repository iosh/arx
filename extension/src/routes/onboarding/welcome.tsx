import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useUiSetupStatus } from "@/ui/hooks/useUiSetupStatus";
import { buildWelcomeIntentNavigation } from "@/ui/lib/onboardingFlow";
import { requireSetupIncomplete } from "@/ui/lib/routeGuards";
import { WelcomeScreen } from "@/ui/screens/onboarding/WelcomeScreen";

export const Route = createFileRoute("/onboarding/welcome")({
  beforeLoad: requireSetupIncomplete,
  component: WelcomeRoute,
});

function WelcomeRoute() {
  const router = useRouter();
  const { data: setupStatus } = useUiSetupStatus();

  return (
    <WelcomeScreen
      onCreate={() => router.navigate(buildWelcomeIntentNavigation({ setupStatus, intent: "create" }))}
      onImport={() => router.navigate(buildWelcomeIntentNavigation({ setupStatus, intent: "import" }))}
    />
  );
}
