import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { ApprovalAccountSelector, ApprovalDetailScreen, useApprovalSnooze } from "@/ui/approvals";
import { LoadingScreen } from "@/ui/components";
import { useUiSnapshot } from "@/ui/hooks/useUiSnapshot";
import { getErrorMessage } from "@/ui/lib/errorUtils";
import { requireVaultInitialized } from "@/ui/lib/routeGuards";
import { ROUTES } from "@/ui/lib/routes";

export const Route = createFileRoute("/approve/request-permissions/$id")({
  beforeLoad: requireVaultInitialized,
  component: ApproveRequestPermissionsByIdPage,
});

function ApproveRequestPermissionsByIdPage() {
  const router = useRouter();
  const { id } = Route.useParams();
  const { snoozeHeadId } = useApprovalSnooze();
  const { snapshot, isLoading, resolveApproval } = useUiSnapshot();
  const [pending, setPending] = useState<"approve" | "reject" | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [selectedAccountKey, setSelectedAccountKey] = useState<string | null>(null);

  const approval = snapshot?.approvals.find((a) => a.id === id);
  const isMatching = approval?.type === "requestPermissions";

  useEffect(() => {
    if (!snapshot) return;
    if (approval && isMatching) return;

    router.navigate({ to: ROUTES.APPROVALS, replace: true });
  }, [approval, isMatching, router, snapshot]);

  useEffect(() => {
    if (!approval || !isMatching) return;

    const selectableIds = new Set(approval.payload.selectableAccounts.map((account) => account.accountKey));
    setSelectedAccountKey((current) => {
      if (current && selectableIds.has(current)) {
        return current;
      }

      return approval.payload.recommendedAccountKey ?? approval.payload.selectableAccounts[0]?.accountKey ?? null;
    });
  }, [approval, isMatching]);

  const handleApprove = async () => {
    if (!approval || !isMatching) return;
    if (!selectedAccountKey) {
      setErrorMessage("Choose an account to continue.");
      return;
    }

    setPending("approve");
    setErrorMessage(null);
    try {
      await resolveApproval({
        id: approval.id,
        action: "approve",
        decision: { accountKeys: [selectedAccountKey] },
      });
      router.navigate({ to: ROUTES.APPROVALS, replace: true });
    } catch (error) {
      setErrorMessage(getErrorMessage(error));
    } finally {
      setPending(null);
    }
  };

  const handleReject = async () => {
    if (!approval || !isMatching) return;
    setPending("reject");
    setErrorMessage(null);
    try {
      await resolveApproval({ id: approval.id, action: "reject", reason: "User rejected" });
      router.navigate({ to: ROUTES.APPROVALS, replace: true });
    } catch (error) {
      setErrorMessage(getErrorMessage(error));
    } finally {
      setPending(null);
    }
  };

  if (isLoading || !snapshot) {
    return <LoadingScreen />;
  }

  if (!approval || !isMatching) {
    return <LoadingScreen />;
  }

  return (
    <ApprovalDetailScreen
      approval={approval}
      onApprove={() => void handleApprove()}
      onReject={() => void handleReject()}
      onBack={() => {
        snoozeHeadId(snapshot.approvals[0]?.id ?? null);
        router.navigate({ to: ROUTES.APPROVALS });
      }}
      pending={pending}
      errorMessage={errorMessage}
      approveDisabled={!selectedAccountKey}
    >
      <ApprovalAccountSelector
        approval={approval}
        selectedAccountKey={selectedAccountKey}
        onSelect={setSelectedAccountKey}
      />
    </ApprovalDetailScreen>
  );
}
