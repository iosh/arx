import type { UiSnapshot } from "@arx/core/ui";
import { useRouter, useRouterState } from "@tanstack/react-router";
import { useEffect, useMemo, useRef } from "react";
import { getEntryIntent } from "@/ui/lib/entryIntent";
import { uiClient } from "@/ui/lib/uiBridgeClient";
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
  const hadApprovalsSinceUnlockRef = useRef(false);
  const waitingForApprovalsRef = useRef(false);

  const isUnlocked = snapshot?.session.isUnlocked ?? false;
  const approvalsHead = snapshot?.approvals[0] ?? null;
  const approvalsCount = snapshot?.approvals.length ?? 0;

  useEffect(() => {
    if (isLoading || !snapshot) return;
    // In manual_open (regular popup), do not auto-navigate; we only auto-route in attention_open (confirmation window).
    if (entryIntent !== "attention_open") return;
    if (!snapshot.vault.initialized) return;

    if (!isUnlocked) {
      hadApprovalsSinceUnlockRef.current = false;
      waitingForApprovalsRef.current = false;
      return;
    }

    if (approvalsCount > 0) {
      hadApprovalsSinceUnlockRef.current = true;
    }

    if (approvalsCount === 0) {
      // If we already had approvals in this unlocked session, close immediately (queue drained).
      if (hadApprovalsSinceUnlockRef.current) {
        window.close();
        return;
      }

      // Otherwise, give a brief window for approvals to arrive after unlock to avoid premature close.
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

    // Ensure any pending "post-unlock wait" doesn't block queue navigation later.
    waitingForApprovalsRef.current = false;

    if (!approvalsHead) return;

    const target = getApprovalRoutePath(approvalsHead);
    if (pathname !== target) router.navigate({ to: target, replace: true });
  }, [approvalsCount, approvalsHead, entryIntent, isLoading, isUnlocked, pathname, router, snapshot]);

  return null;
}
