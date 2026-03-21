import type { ApprovalSummary, UiSnapshot } from "@arx/core/ui";
import { ROUTES } from "@/ui/lib/routes";
import { getApprovalRoutePath } from "./routes";

type ApprovalOfType<T extends ApprovalSummary["type"]> = ApprovalSummary & Extract<ApprovalSummary, { type: T }>;

export type ApprovalRouteEntry<T extends ApprovalSummary["type"]> =
  | { status: "loading" }
  | { status: "redirect"; to: string; replace: true }
  | { status: "ready"; approval: ApprovalOfType<T> };

function isApprovalOfType<T extends ApprovalSummary["type"]>(
  approval: ApprovalSummary,
  expectedType: T,
): approval is ApprovalOfType<T> {
  return approval.type === expectedType;
}

export function getApprovalRouteEntry<T extends ApprovalSummary["type"]>(params: {
  snapshot: UiSnapshot | undefined;
  isLoading: boolean;
  approvalId: string;
  expectedType: T;
}): ApprovalRouteEntry<T> {
  const { snapshot, isLoading, approvalId, expectedType } = params;

  if (isLoading || !snapshot) {
    return { status: "loading" };
  }

  const approval = snapshot.approvals.find((item) => item.id === approvalId);
  if (!approval) {
    return { status: "redirect", to: ROUTES.APPROVALS, replace: true };
  }

  if (!isApprovalOfType(approval, expectedType)) {
    return { status: "redirect", to: getApprovalRoutePath(approval), replace: true };
  }

  return {
    status: "ready",
    approval,
  };
}
