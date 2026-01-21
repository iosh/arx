import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { ApprovalDetailScreen } from "@/ui/approvals";
import { LoadingScreen } from "@/ui/components";
import { useUiSnapshot } from "@/ui/hooks/useUiSnapshot";
import { getEntryIntent } from "@/ui/lib/entryIntent";
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
  const { snapshot, isLoading, approveApproval, rejectApproval } = useUiSnapshot();
  const [pending, setPending] = useState<"approve" | "reject" | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const approval = snapshot?.approvals.find((a) => a.id === id);
  const isMatching = approval?.type === "requestPermissions";

  useEffect(() => {
    if (!snapshot) return;
    if (approval && isMatching) return;

    const entryIntent = getEntryIntent();
    if (entryIntent === "attention_open") {
      window.close();
      return;
    }

    router.navigate({ to: ROUTES.APPROVALS, replace: true });
  }, [approval, isMatching, router, snapshot]);

  const handleApprove = async () => {
    if (!approval || !isMatching) return;
    setPending("approve");
    setErrorMessage(null);
    try {
      await approveApproval(approval.id);
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
      await rejectApproval({ id: approval.id, reason: "User rejected" });
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
      onBack={() => router.navigate({ to: ROUTES.APPROVALS })}
      pending={pending}
      errorMessage={errorMessage}
    />
  );
}
