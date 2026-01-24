import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useCallback } from "react";
import { requireVaultUninitialized } from "@/ui/lib/routeGuards";
import { ROUTES } from "@/ui/lib/routes";
import { PasswordSetupScreen } from "@/ui/screens/onboarding/PasswordSetupScreen";
import { useOnboardingStore } from "@/ui/stores/onboardingStore";

type PasswordSetupIntent = "create" | "import";

export const Route = createFileRoute("/onboarding/password")({
  beforeLoad: requireVaultUninitialized,
  validateSearch: (search): { intent: PasswordSetupIntent } => ({
    intent: (search.intent === "import" ? "import" : "create") as PasswordSetupIntent,
  }),
  component: PasswordSetupRoute,
});

function PasswordSetupRoute() {
  const router = useRouter();
  const search = Route.useSearch();
  const setPassword = useOnboardingStore((s) => s.setPassword);

  const handleSubmit = useCallback(
    async (password: string) => {
      setPassword(password);

      if (search.intent === "import") {
        router.navigate({ to: ROUTES.ONBOARDING_IMPORT });
        return;
      }

      router.navigate({ to: ROUTES.ONBOARDING_GENERATE });
    },
    [router, search.intent, setPassword],
  );

  return <PasswordSetupScreen onSubmit={handleSubmit} />;
}
