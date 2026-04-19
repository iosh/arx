import type { ApprovalDetail, ApprovalListEntry } from "@arx/core/ui";

const APPROVAL_TYPE_LABEL = {
  requestAccounts: "Connect Account",
  signMessage: "Sign Message",
  signTypedData: "Sign Typed Data",
  sendTransaction: "Send Transaction",
  requestPermissions: "Account Access",
  switchChain: "Switch Network",
  addChain: "Add Network",
} satisfies Record<ApprovalDetail["kind"] | ApprovalListEntry["kind"], string>;

export function getApprovalTypeLabel(type: ApprovalDetail["kind"] | ApprovalListEntry["kind"]): string {
  return APPROVAL_TYPE_LABEL[type];
}
