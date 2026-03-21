import type { UiSnapshot } from "@arx/core/ui";
import { useRouter, useRouterState } from "@tanstack/react-router";
import { useEffect, useMemo, useRef } from "react";
import { getEntryIntent } from "@/ui/lib/entryIntent";
import { uiClient } from "@/ui/lib/uiBridgeClient";
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
  const entryIntent = useMemo(() => getEntryIntent(), []);
  const requestedApprovalId = useMemo(() => {
    try {
      return new URL(window.location.href).searchParams.get("approvalId");
    } catch {
      return null;
    }
  }, []);
  const hadApprovalsSinceUnlockRef = useRef(false);
  const waitingForApprovalsRef = useRef(false);
  const waitingForRequestedApprovalRef = useRef(false);

  useEffect(() => {
    const plan = getApprovalAttentionAction({
      snapshot,
      isLoading,
      entryIntent,
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
      void uiClient
        .waitForSnapshot({
          timeoutMs: 2_000,
          predicate: (s) => s.session.isUnlocked && s.approvals.some((item) => item.id === requestedApprovalId),
        })
        .then((s) => {
          if (cancelled) return;
          const next = s.approvals.find((item) => item.id === requestedApprovalId);
          if (!next) return;
          router.navigate({ to: getApprovalRoutePath(next), replace: true });
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
      void uiClient
        .waitForSnapshot({
          timeoutMs: 750,
          predicate: (s) => s.session.isUnlocked && s.approvals.length > 0,
        })
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
  }, [entryIntent, isLoading, pathname, requestedApprovalId, router, snapshot]);

  return null;
}
