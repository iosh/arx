import type { ApprovalSummary } from "@arx/core/ui";

const APPROVAL_TYPE_LABEL = {
  requestAccounts: "Connect Account",
  signMessage: "Sign Message",
  signTypedData: "Sign Typed Data",
  sendTransaction: "Send Transaction",
  requestPermissions: "Account Access",
  switchChain: "Switch Network",
  addChain: "Add Network",
  unsupported: "Unsupported Request",
} satisfies Record<ApprovalSummary["type"], string>;

export function getApprovalTypeLabel(type: ApprovalSummary["type"]): string {
  return APPROVAL_TYPE_LABEL[type];
}
