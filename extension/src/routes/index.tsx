import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useUiSnapshot } from "@/ui/hooks/useUiSnapshot";
import { getErrorMessage } from "@/ui/lib/errorUtils";
import { redirectToSetupIfNoAccounts } from "@/ui/lib/routeGuards";
import { ROUTES } from "@/ui/lib/routes";
import { pushToast } from "@/ui/lib/toast";
import { uiClient } from "@/ui/lib/uiBridgeClient";
import { HomeScreen } from "@/ui/screens/HomeScreen";

export const Route = createFileRoute("/")({
  beforeLoad: redirectToSetupIfNoAccounts,
  component: HomePage,
});
function HomePage() {
  const router = useRouter();
  const { snapshot, markBackedUp } = useUiSnapshot();
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
      pushToast({ kind: "error", message: getErrorMessage(error), dedupeKey: `mark-backed-up:${keyringId}` });
      throw error;
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
      onOpenApprovals={() => {
        void uiClient.attention
          .openNotification()
          .then(() => window.close())
          .catch((error) => {
            pushToast({ kind: "error", message: getErrorMessage(error), dedupeKey: "open-approvals" });
            router.navigate({ to: ROUTES.APPROVALS });
          });
      }}
      onNavigateAccounts={() => router.navigate({ to: ROUTES.ACCOUNTS })}
      onNavigateNetworks={() => router.navigate({ to: ROUTES.NETWORKS })}
      onNavigateSettings={() => router.navigate({ to: ROUTES.SETTINGS })}
    />
  );
}
