import type { UiSnapshot } from "@arx/core/ui";
import { useRouter, useRouterState } from "@tanstack/react-router";
import { useEffect, useRef } from "react";
import { useUiEntryMetadata } from "@/ui/hooks/useUiEntryMetadata";
import { waitForAnyApprovalInSnapshot, waitForApprovalInSnapshot } from "./approvalSnapshotWait";
import { getApprovalAttentionAction } from "./orchestration";
import { getApprovalRoutePath } from "./routes";

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
  const waitingForApprovalsRef = useRef(false);
  const waitingForRequestedApprovalRef = useRef(false);

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

    if (plan.action.type !== "waitForAnyApproval") {
      waitingForApprovalsRef.current = false;
    }
    if (plan.action.type !== "waitForRequestedApproval") {
      waitingForRequestedApprovalRef.current = false;
    }

    if (plan.action.type === "reset") {
      waitingForApprovalsRef.current = false;
      waitingForRequestedApprovalRef.current = false;
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
      return;
    }

    if (plan.action.type === "waitForRequestedApproval") {
      if (!requestedApprovalId || waitingForRequestedApprovalRef.current) return;
      waitingForRequestedApprovalRef.current = true;

      let cancelled = false;
      void waitForApprovalInSnapshot(requestedApprovalId, { requireUnlocked: true })
        .then((approval) => {
          if (cancelled) return;
          if (!approval) return;
          router.navigate({ to: getApprovalRoutePath(approval), replace: true });
        })
        .catch(() => {
          // Keep the window open; the approval may arrive later.
        })
        .finally(() => {
          if (cancelled) return;
          waitingForRequestedApprovalRef.current = false;
        });

      return () => {
        cancelled = true;
      };
    }

    if (plan.action.type === "waitForAnyApproval") {
      if (waitingForApprovalsRef.current) return;
      waitingForApprovalsRef.current = true;

      let cancelled = false;
      void waitForAnyApprovalInSnapshot()
        .catch(() => {
          if (cancelled) return;
          window.close();
        })
        .finally(() => {
          if (cancelled) return;
          waitingForApprovalsRef.current = false;
        });

      return () => {
        cancelled = true;
      };
    }
  }, [entry, isLoading, pathname, requestedApprovalId, router, snapshot]);

  return null;
}
