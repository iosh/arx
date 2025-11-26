import { createFileRoute, useRouter } from "@tanstack/react-router";
import { LoadingScreen } from "@/ui/components";
import { useUiSnapshot } from "@/ui/hooks/useUiSnapshot";
import { ROUTES } from "@/ui/lib/routes";
import { HomeScreen } from "@/ui/screens/HomeScreen";
import { InitScreen } from "@/ui/screens/InitScreen";
import { UnlockScreen } from "@/ui/screens/UnlockScreen";

export const Route = createFileRoute("/")({
  component: HomePage,
});

function HomePage() {
  const router = useRouter();
  const { snapshot, isLoading, vaultInit, unlock, lock } = useUiSnapshot();

  if (isLoading || !snapshot) {
    return <LoadingScreen />;
  }

  if (!snapshot.vault.initialized) {
    return <InitScreen onSubmit={vaultInit} />;
  }

  if (!snapshot.session.isUnlocked) {
    return <UnlockScreen onSubmit={unlock} />;
  }

  return (
    <HomeScreen
      snapshot={snapshot}
      onLock={lock}
      onNavigateAccounts={() => router.navigate({ to: ROUTES.ACCOUNTS })}
      onNavigateNetworks={() => router.navigate({ to: ROUTES.NETWORKS })}
      onNavigateApprovals={() => router.navigate({ to: ROUTES.APPROVALS })}
      onNavigateSettings={() => router.navigate({ to: ROUTES.SETTINGS })}
    />
  );
}
