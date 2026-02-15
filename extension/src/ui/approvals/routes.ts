import type { ApprovalSummary } from "@arx/core/ui";

const APPROVAL_ROUTE_PREFIX = {
  requestAccounts: "/approve/request-accounts",
  requestPermissions: "/approve/request-permissions",
  signMessage: "/approve/sign-message",
  signTypedData: "/approve/sign-typed-data",
  sendTransaction: "/approve/send-transaction",
  switchChain: "/approve/switch-chain",
  addChain: "/approve/add-chain",
} satisfies Record<ApprovalSummary["type"], string>;

export function getApprovalRoutePath(approval: ApprovalSummary): string {
  return `${APPROVAL_ROUTE_PREFIX[approval.type]}/${approval.id}`;
}
