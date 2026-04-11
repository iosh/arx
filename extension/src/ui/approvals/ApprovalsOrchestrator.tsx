import type { UiSnapshot } from "@arx/core/ui";
import { useRouter, useRouterState } from "@tanstack/react-router";
import { useEffect, useRef } from "react";
import { useUiEntryMetadata } from "@/ui/hooks/useUiEntryMetadata";
import { getApprovalAttentionAction } from "./orchestration";

export function ApprovalsOrchestrator({
  snapshot,
  isLoading,
}: {
  snapshot: UiSnapshot | undefined;
  isLoading: boolean;
}) {
  const router = useRouter();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const entry = useUiEntryMetadata();
  const requestedApprovalId = entry.context.approvalId;
  const hadApprovalsSinceUnlockRef = useRef(false);

  useEffect(() => {
    const plan = getApprovalAttentionAction({
      snapshot,
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
  }, [entry, isLoading, pathname, requestedApprovalId, router, snapshot]);

  return null;
}
