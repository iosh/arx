import type { ApprovalDetail } from "@arx/core/wallet";
import { useRouter } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { ROUTES } from "@/ui/lib/routes";
import { ApprovalAccountSelector } from "./ApprovalAccountSelector";
import { ApprovalDetailScreen } from "./ApprovalDetailScreen";
import { useApprovalResolveAction } from "./useApprovalResolveAction";

type SimpleApprovalKind = Exclude<ApprovalDetail["kind"], "requestAccounts" | "requestPermissions">;
type SimpleApproval = Extract<ApprovalDetail, { kind: SimpleApprovalKind }>;
type AccountSelectionApproval = Extract<ApprovalDetail, { kind: "requestAccounts" | "requestPermissions" }>;

function getPreferredAccountId(approval: AccountSelectionApproval, currentSelection: string | null): string | null {
  const selectableAccountIds = new Set(approval.request.selectableAccounts.map((account) => account.accountId));
  if (currentSelection && selectableAccountIds.has(currentSelection)) {
    return currentSelection;
  }

  return approval.request.recommendedAccountId ?? approval.request.selectableAccounts[0]?.accountId ?? null;
}

export function SimpleApprovalRoutePage(params: {
  approvalId: string;
  approval: SimpleApproval;
  rejectReason?: string;
}) {
  const router = useRouter();
  const { approvalId, approval, rejectReason = "User rejected" } = params;
  const { pendingAction, errorMessage, submitResolution } = useApprovalResolveAction();
  const approveParams =
    approval.kind === "sendTransaction"
      ? {
          approvalId,
          action: "approve" as const,
          expectedPrepareId: approval.request.prepareId ?? undefined,
        }
      : {
          approvalId,
          action: "approve" as const,
        };

  return (
    <ApprovalDetailScreen
      approval={approval}
      onApprove={() => void submitResolution(approveParams)}
      onReject={() => void submitResolution({ approvalId, action: "reject", reason: rejectReason })}
      onBack={() => void router.navigate({ to: ROUTES.APPROVALS })}
      pending={pendingAction}
      errorMessage={errorMessage}
      approveDisabled={!approval.actions.canApprove}
    />
  );
}

export function AccountSelectionApprovalRoutePage(params: {
  approvalId: string;
  approval: AccountSelectionApproval;
  rejectReason?: string;
}) {
  const router = useRouter();
  const { approvalId, approval, rejectReason = "User rejected" } = params;
  const { pendingAction, errorMessage, submitResolution, showError, clearError } = useApprovalResolveAction();
  const [selectedAccountId, setSelectedAccountId] = useState<string | null>(null);

  useEffect(() => {
    setSelectedAccountId((current) => getPreferredAccountId(approval, current));
  }, [approval]);

  return (
    <ApprovalDetailScreen
      approval={approval}
      onApprove={() => {
        if (!selectedAccountId) {
          showError("Choose an account to continue.");
          return;
        }

        void submitResolution({
          approvalId,
          action: "approve",
          decision: { accountIds: [selectedAccountId] },
        });
      }}
      onReject={() => void submitResolution({ approvalId, action: "reject", reason: rejectReason })}
      onBack={() => void router.navigate({ to: ROUTES.APPROVALS })}
      pending={pendingAction}
      errorMessage={errorMessage}
      approveDisabled={!selectedAccountId || !approval.actions.canApprove}
    >
      <ApprovalAccountSelector
        approval={approval}
        selectedAccountId={selectedAccountId}
        onSelect={(accountId) => {
          clearError();
          setSelectedAccountId(accountId);
        }}
      />
    </ApprovalDetailScreen>
  );
}
