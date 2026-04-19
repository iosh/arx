import type { ApprovalDetail } from "@arx/core/ui";
import { useRouter } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { ROUTES } from "@/ui/lib/routes";
import { ApprovalAccountSelector } from "./ApprovalAccountSelector";
import { ApprovalDetailScreen } from "./ApprovalDetailScreen";
import { useApprovalResolveAction } from "./useApprovalResolveAction";

type SimpleApprovalKind = Exclude<ApprovalDetail["kind"], "requestAccounts" | "requestPermissions">;
type SimpleApproval = Extract<ApprovalDetail, { kind: SimpleApprovalKind }>;
type AccountSelectionApproval = Extract<ApprovalDetail, { kind: "requestAccounts" | "requestPermissions" }>;

function getPreferredAccountKey(approval: AccountSelectionApproval, currentSelection: string | null): string | null {
  const selectableAccountKeys = new Set(approval.request.selectableAccounts.map((account) => account.accountKey));
  if (currentSelection && selectableAccountKeys.has(currentSelection)) {
    return currentSelection;
  }

  return approval.request.recommendedAccountKey ?? approval.request.selectableAccounts[0]?.accountKey ?? null;
}

export function SimpleApprovalRoutePage(params: {
  approvalId: string;
  approval: SimpleApproval;
  rejectReason?: string;
}) {
  const router = useRouter();
  const { approvalId, approval, rejectReason = "User rejected" } = params;
  const { pendingAction, errorMessage, submitResolution } = useApprovalResolveAction();

  return (
    <ApprovalDetailScreen
      approval={approval}
      onApprove={() => void submitResolution({ approvalId, action: "approve" })}
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
  const [selectedAccountKey, setSelectedAccountKey] = useState<string | null>(null);

  useEffect(() => {
    setSelectedAccountKey((current) => getPreferredAccountKey(approval, current));
  }, [approval]);

  return (
    <ApprovalDetailScreen
      approval={approval}
      onApprove={() => {
        if (!selectedAccountKey) {
          showError("Choose an account to continue.");
          return;
        }

        void submitResolution({
          approvalId,
          action: "approve",
          decision: { accountKeys: [selectedAccountKey] },
        });
      }}
      onReject={() => void submitResolution({ approvalId, action: "reject", reason: rejectReason })}
      onBack={() => void router.navigate({ to: ROUTES.APPROVALS })}
      pending={pendingAction}
      errorMessage={errorMessage}
      approveDisabled={!selectedAccountKey || !approval.actions.canApprove}
    >
      <ApprovalAccountSelector
        approval={approval}
        selectedAccountKey={selectedAccountKey}
        onSelect={(accountKey) => {
          clearError();
          setSelectedAccountKey(accountKey);
        }}
      />
    </ApprovalDetailScreen>
  );
}
