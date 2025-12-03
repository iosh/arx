import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { LoadingScreen } from "@/ui/components";
import { useUiSnapshot } from "@/ui/hooks/useUiSnapshot";
import { ROUTES } from "@/ui/lib/routes";
import { HomeScreen } from "@/ui/screens/HomeScreen";
import { UnlockScreen } from "@/ui/screens/UnlockScreen";

export const Route = createFileRoute("/")({
  component: HomePage,
});

function HomePage() {
  const router = useRouter();
  const { snapshot, isLoading, unlock, lock, markBackedUp } = useUiSnapshot();
  const accountCount = snapshot?.accounts.list.length ?? 0;
  const [markingId, setMarkingId] = useState<string | null>(null);

  const backupWarnings = useMemo(
    () => snapshot?.warnings.hdKeyringsNeedingBackup ?? [],
    [snapshot?.warnings.hdKeyringsNeedingBackup],
  );

  const handleMarkBackedUp = async (keyringId: string) => {
    setMarkingId(keyringId);
    try {
      await markBackedUp(keyringId);
    } catch (error) {
      console.warn("[HomePage] failed to mark keyring backup", error);
    } finally {
      setMarkingId((current) => (current === keyringId ? null : current));
    }
  };

  useEffect(() => {
    if (!snapshot) return;
    if (!snapshot.vault.initialized) {
      router.navigate({ to: ROUTES.WELCOME });
    }
  }, [router, snapshot?.vault.initialized, snapshot]);

  useEffect(() => {
    if (!snapshot) return;
    if (!snapshot.vault.initialized) return;
    if (!snapshot.session.isUnlocked) return;
    if (accountCount > 0) return;
    router.navigate({ to: ROUTES.SETUP_GENERATE });
  }, [router, snapshot?.vault.initialized, snapshot?.session.isUnlocked, accountCount, snapshot]);

  if (isLoading || !snapshot) {
    return <LoadingScreen />;
  }

  if (!snapshot.session.isUnlocked) {
    return <UnlockScreen onSubmit={unlock} />;
  }

  return (
    <HomeScreen
      snapshot={snapshot}
      backupWarnings={backupWarnings}
      onMarkBackedUp={handleMarkBackedUp}
      markingKeyringId={markingId}
      onLock={lock}
      onNavigateAccounts={() => router.navigate({ to: ROUTES.ACCOUNTS })}
      onNavigateNetworks={() => router.navigate({ to: ROUTES.NETWORKS })}
      onNavigateApprovals={() => router.navigate({ to: ROUTES.APPROVALS })}
      onNavigateSettings={() => router.navigate({ to: ROUTES.SETTINGS })}
    />
  );
}
