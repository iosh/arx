import { createFileRoute, useRouter } from "@tanstack/react-router";
import { requireVaultUninitialized } from "@/ui/lib/routeGuards";
import { ROUTES } from "@/ui/lib/routes";
import { WelcomeScreen } from "@/ui/screens/onboarding/WelcomeScreen";

export const Route = createFileRoute("/welcome")({
  beforeLoad: requireVaultUninitialized,
  component: WelcomeRoute,
});

function WelcomeRoute() {
  const router = useRouter();

  return (
    <WelcomeScreen
      onCreate={() => router.navigate({ to: ROUTES.SETUP_PASSWORD })}
      onImportMnemonic={() => router.navigate({ to: ROUTES.SETUP_IMPORT, search: { mode: "mnemonic" } })}
      onImportPrivateKey={() => router.navigate({ to: ROUTES.SETUP_IMPORT, search: { mode: "privateKey" } })}
    />
  );
}
