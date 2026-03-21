import type { ApprovalSummary } from "@arx/core/ui";
import { useRouter } from "@tanstack/react-router";
import { useEffect } from "react";
import { useUiSnapshot } from "@/ui/hooks/useUiSnapshot";
import { getApprovalRouteEntry } from "./routeEntry";

export function useApprovalRouteEntry<T extends ApprovalSummary["type"]>(params: {
  approvalId: string;
  expectedType: T;
}) {
  const router = useRouter();
  const { snapshot, isLoading } = useUiSnapshot();
  const entry = getApprovalRouteEntry({
    snapshot,
    isLoading,
    approvalId: params.approvalId,
    expectedType: params.expectedType,
  });

  const redirectTarget = entry.status === "redirect" ? entry.to : null;

  useEffect(() => {
    if (!redirectTarget) return;
    router.navigate({ to: redirectTarget, replace: true });
  }, [redirectTarget, router]);

  return entry;
}
