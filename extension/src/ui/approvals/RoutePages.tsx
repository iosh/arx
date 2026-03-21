import type { ApprovalSummary } from "@arx/core/ui";
import { useRouter } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { LoadingScreen } from "@/ui/components";
import { ROUTES } from "@/ui/lib/routes";
import { ApprovalAccountSelector } from "./ApprovalAccountSelector";
import { ApprovalDetailScreen } from "./ApprovalDetailScreen";
import { useApprovalResolveAction } from "./useApprovalResolveAction";
import { useApprovalRouteEntry } from "./useApprovalRouteEntry";

type SimpleApprovalType = Exclude<ApprovalSummary["type"], "requestAccounts" | "requestPermissions" | "unsupported">;
type AccountSelectionApproval = Extract<ApprovalSummary, { type: "requestAccounts" | "requestPermissions" }>;

function getPreferredAccountKey(approval: AccountSelectionApproval, currentSelection: string | null): string | null {
  const selectableAccountKeys = new Set(approval.payload.selectableAccounts.map((account) => account.accountKey));
  if (currentSelection && selectableAccountKeys.has(currentSelection)) {
    return currentSelection;
  }

  return approval.payload.recommendedAccountKey ?? approval.payload.selectableAccounts[0]?.accountKey ?? null;
}

export function SimpleApprovalRoutePage<T extends SimpleApprovalType>(params: {
  approvalId: string;
  expectedType: T;
  rejectReason?: string;
}) {
  const router = useRouter();
  const { approvalId, expectedType, rejectReason = "User rejected" } = params;
  const entry = useApprovalRouteEntry({ approvalId, expectedType });
  const { pendingAction, errorMessage, submitResolution } = useApprovalResolveAction();

  if (entry.status !== "ready") {
    return <LoadingScreen />;
  }

  const approval = entry.approval;

  return (
    <ApprovalDetailScreen
      approval={approval}
      onApprove={() => void submitResolution({ id: approvalId, action: "approve" })}
      onReject={() => void submitResolution({ id: approvalId, action: "reject", reason: rejectReason })}
      onBack={() => void router.navigate({ to: ROUTES.APPROVALS })}
      pending={pendingAction}
      errorMessage={errorMessage}
    />
  );
}

export function RejectOnlyApprovalRoutePage(params: {
  approvalId: string;
  expectedType: "unsupported";
  rejectReason: string;
}) {
  const router = useRouter();
  const entry = useApprovalRouteEntry({
    approvalId: params.approvalId,
    expectedType: params.expectedType,
  });
  const { pendingAction, errorMessage, submitResolution } = useApprovalResolveAction();

  if (entry.status !== "ready") {
    return <LoadingScreen />;
  }

  const approval = entry.approval;

  return (
    <ApprovalDetailScreen
      approval={approval}
      onReject={() => void submitResolution({ id: params.approvalId, action: "reject", reason: params.rejectReason })}
      onBack={() => void router.navigate({ to: ROUTES.APPROVALS })}
      pending={pendingAction}
      errorMessage={errorMessage}
    />
  );
}

export function AccountSelectionApprovalRoutePage<T extends AccountSelectionApproval["type"]>(params: {
  approvalId: string;
  expectedType: T;
  rejectReason?: string;
}) {
  const router = useRouter();
  const { approvalId, expectedType, rejectReason = "User rejected" } = params;
  const entry = useApprovalRouteEntry({ approvalId, expectedType });
  const { pendingAction, errorMessage, submitResolution, showError, clearError } = useApprovalResolveAction();
  const [selectedAccountKey, setSelectedAccountKey] = useState<string | null>(null);
  const approval = entry.status === "ready" ? entry.approval : null;

  useEffect(() => {
    if (!approval) return;
    setSelectedAccountKey((current) => getPreferredAccountKey(approval, current));
  }, [approval]);

  if (!approval) {
    return <LoadingScreen />;
  }

  return (
    <ApprovalDetailScreen
      approval={approval}
      onApprove={() => {
        if (!selectedAccountKey) {
          showError("Choose an account to continue.");
          return;
        }

        void submitResolution({
          id: approvalId,
          action: "approve",
          decision: { accountKeys: [selectedAccountKey] },
        });
      }}
      onReject={() => void submitResolution({ id: approvalId, action: "reject", reason: rejectReason })}
      onBack={() => void router.navigate({ to: ROUTES.APPROVALS })}
      pending={pendingAction}
      errorMessage={errorMessage}
      approveDisabled={!selectedAccountKey}
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
