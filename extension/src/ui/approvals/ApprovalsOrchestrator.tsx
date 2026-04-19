import { useRouter, useRouterState } from "@tanstack/react-router";
import { useEffect, useRef } from "react";
import { useUiApprovalsList } from "@/ui/hooks/useUiApprovals";
import { useUiEntryMetadata } from "@/ui/hooks/useUiEntryMetadata";
import { getApprovalAttentionAction } from "./orchestration";

export function ApprovalsOrchestrator() {
  const router = useRouter();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const entry = useUiEntryMetadata();
  const { approvals, isLoading } = useUiApprovalsList();
  const requestedApprovalId = entry.context.approvalId;
  const hadApprovalsSinceUnlockRef = useRef(false);

  useEffect(() => {
    const plan = getApprovalAttentionAction({
      approvals,
      isLoading,
      entry,
      pathname,
      requestedApprovalId,
      hadApprovalsSinceUnlock: hadApprovalsSinceUnlockRef.current,
    });

    hadApprovalsSinceUnlockRef.current = plan.nextHadApprovalsSinceUnlock;

    if (plan.action.type === "reset") {
      return;
    }

    if (plan.action.type === "close") {
      window.close();
      return;
    }

    if (plan.action.type === "navigate") {
      if (pathname !== plan.action.to) {
        router.navigate({ to: plan.action.to, replace: true });
      }
    }
  }, [approvals, entry, isLoading, pathname, requestedApprovalId, router]);

  return null;
}
