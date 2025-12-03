import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useCallback } from "react";
import { useUiSnapshot } from "@/ui/hooks/useUiSnapshot";
import { requireVaultUninitialized } from "@/ui/lib/routeGuards";
import { ROUTES } from "@/ui/lib/routes";
import { InitScreen } from "@/ui/screens/InitScreen";

export const Route = createFileRoute("/setup/password")({
  beforeLoad: requireVaultUninitialized,
  component: PasswordSetupRoute,
});
function PasswordSetupRoute() {
  const router = useRouter();
  const { vaultInit, unlock } = useUiSnapshot();

  const handleSubmit = useCallback(
    async (password: string) => {
      await vaultInit(password);
      await unlock(password);
      router.navigate({ to: ROUTES.SETUP_GENERATE });
    },
    [router, unlock, vaultInit],
  );

  return <InitScreen onSubmit={handleSubmit} />;
}
