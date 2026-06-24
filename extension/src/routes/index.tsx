import { useMutation } from "@tanstack/react-query";
import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useState } from "react";
import { useNativeBalanceQuery } from "@/ui/hooks/useNativeBalanceQuery";
import { useUiApprovalsList } from "@/ui/hooks/useUiApprovals";
import { useUiCurrentChainAccounts } from "@/ui/hooks/useUiCurrentChainAccounts";
import { useUiKeyringBackupStatus } from "@/ui/hooks/useUiKeyringBackupStatus";
import { getErrorMessage } from "@/ui/lib/errorUtils";
import { redirectToSetupIfNoAccounts } from "@/ui/lib/routeGuards";
import { ROUTES } from "@/ui/lib/routes";
import { pushToast } from "@/ui/lib/toast";
import { app } from "@/ui/lib/uiBridgeClient";
import { HomeScreen } from "@/ui/screens/HomeScreen";

export const Route = createFileRoute("/")({
  beforeLoad: redirectToSetupIfNoAccounts,
  component: HomePage,
});
function HomePage() {
  const router = useRouter();
  const accountsQuery = useUiCurrentChainAccounts();
  const { backupStatus, markBackedUp } = useUiKeyringBackupStatus();
  const { approvals } = useUiApprovalsList();
  const exportMnemonicMutation = useMutation({
    mutationFn: (params: { keyringId: string; password: string }) => app.wallet.keyrings.exportMnemonic(params),
  });
  const [markingId, setMarkingId] = useState<string | null>(null);

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

  const handleExportMnemonic = async (params: { keyringId: string; password: string }) => {
    try {
      const res = await exportMnemonicMutation.mutateAsync(params);
      return res.words;
    } catch (error) {
      console.warn("[HomePage] failed to export mnemonic", error);
      throw error;
    }
  };

  const homeStatus = accountsQuery.data;
  const nativeBalance = useNativeBalanceQuery({
    chainRef: homeStatus?.chain.chainRef ?? null,
    accountKey: homeStatus?.accounts.active?.accountKey ?? null,
    enabled: homeStatus?.session.isUnlocked ?? false,
  });

  if (!homeStatus || !backupStatus) {
    return null;
  }

  return (
    <HomeScreen
      chain={homeStatus.chain}
      accounts={homeStatus.accounts}
      backupStatus={backupStatus}
      approvals={approvals ?? []}
      nativeBalance={nativeBalance.balance}
      nativeBalanceLoading={nativeBalance.isInitialLoading}
      nativeBalanceError={nativeBalance.error ? "Failed to load balance" : null}
      onMarkBackedUp={handleMarkBackedUp}
      onExportMnemonic={handleExportMnemonic}
      markingKeyringId={markingId}
      onOpenApprovals={() => void router.navigate({ to: ROUTES.APPROVALS })}
      onNavigateAccounts={() => router.navigate({ to: ROUTES.ACCOUNTS })}
      onNavigateNetworks={() => router.navigate({ to: ROUTES.NETWORKS })}
      onNavigateSend={() => router.navigate({ to: ROUTES.SEND })}
      onNavigateSettings={() => router.navigate({ to: ROUTES.SETTINGS })}
    />
  );
}
