import type { ApprovalDetail } from "@arx/core/ui";

export function readApprovalDetailForRoute(input: {
  initialDetail: ApprovalDetail;
  currentDetail: ApprovalDetail | null | undefined;
}): ApprovalDetail | null {
  if (input.currentDetail === undefined) {
    return input.initialDetail;
  }

  return input.currentDetail;
}
