import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useCallback } from "react";
import { useUiSnapshot } from "@/ui/hooks/useUiSnapshot";
import { requireVaultUninitialized } from "@/ui/lib/routeGuards";
import { ROUTES } from "@/ui/lib/routes";
import { PasswordSetupScreen } from "@/ui/screens/onboarding/PasswordSetupScreen";

type PasswordSetupIntent = "create" | "import";
type ImportMode = "mnemonic" | "privateKey";

export const Route = createFileRoute("/setup/password")({
  beforeLoad: requireVaultUninitialized,
  validateSearch: (search) => ({
    intent: (search.intent === "import" ? "import" : "create") as PasswordSetupIntent,
    mode: (search.mode === "privateKey" ? "privateKey" : "mnemonic") as ImportMode,
  }),
  component: PasswordSetupRoute,
});
function PasswordSetupRoute() {
  const router = useRouter();
  const search = Route.useSearch();
  const { vaultInit, unlock } = useUiSnapshot();

  const handleSubmit = useCallback(
    async (password: string) => {
      await vaultInit(password);
      await unlock(password);
      if (search.intent === "import") {
        router.navigate({ to: ROUTES.SETUP_IMPORT, search: { mode: search.mode } });
        return;
      }
      router.navigate({ to: ROUTES.SETUP_GENERATE });
    },
    [router, search.intent, search.mode, unlock, vaultInit],
  );

  return <PasswordSetupScreen onSubmit={handleSubmit} />;
}
