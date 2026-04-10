import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useUiSnapshot } from "@/ui/hooks/useUiSnapshot";
import { buildWelcomeIntentNavigation } from "@/ui/lib/onboardingFlow";
import { requireSetupIncomplete } from "@/ui/lib/routeGuards";
import { WelcomeScreen } from "@/ui/screens/onboarding/WelcomeScreen";

export const Route = createFileRoute("/onboarding/welcome")({
  beforeLoad: requireSetupIncomplete,
  component: WelcomeRoute,
});

function WelcomeRoute() {
  const router = useRouter();
  const { snapshot } = useUiSnapshot();

  return (
    <WelcomeScreen
      onCreate={() => router.navigate(buildWelcomeIntentNavigation({ snapshot, intent: "create" }))}
      onImport={() => router.navigate(buildWelcomeIntentNavigation({ snapshot, intent: "import" }))}
    />
  );
}
