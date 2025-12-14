import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useUiSnapshot } from "@/ui/hooks/useUiSnapshot";
import { redirectToSetupIfNoAccounts } from "@/ui/lib/routeGuards";
import { ROUTES } from "@/ui/lib/routes";
import { HomeScreen } from "@/ui/screens/HomeScreen";

export const Route = createFileRoute("/")({
  beforeLoad: redirectToSetupIfNoAccounts,
  component: HomePage,
});
function HomePage() {
  const router = useRouter();
  const { snapshot, lock, markBackedUp } = useUiSnapshot();
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

  if (!snapshot) {
    return null;
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
