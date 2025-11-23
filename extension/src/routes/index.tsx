import { createFileRoute } from "@tanstack/react-router";
import { Spinner, YStack } from "tamagui";
import { useUiSnapshot } from "@/ui/hooks/useUiSnapshot";
import { HomeScreen } from "@/ui/screens/HomeScreen";
import { InitScreen } from "@/ui/screens/InitScreen";
import { UnlockScreen } from "@/ui/screens/UnlockScreen";

// Define the home page route (/)
export const Route = createFileRoute("/")({
  component: HomePage,
});

function HomePage() {
  const { snapshot, isLoading, vaultInit, unlock, lock } = useUiSnapshot();
  const logPlaceholder = (label: string) => () => console.info(`[HomePage] ${label} flow not implemented yet`);
  const navigateAccounts = logPlaceholder("accounts");
  const navigateNetworks = logPlaceholder("networks");
  const navigateApprovals = logPlaceholder("approvals");
  if (isLoading || !snapshot) {
    return (
      <YStack flex={1} alignItems="center" justifyContent="center">
        <Spinner size="large" />
      </YStack>
    );
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
      onNavigateAccounts={navigateAccounts}
      onNavigateNetworks={navigateNetworks}
      onNavigateApprovals={navigateApprovals}
    />
  );
}
