import { ApprovalKinds } from "../../approvals/queue/types.js";
import { deriveApprovalReviewContext, parseNoDecision } from "../shared.js";
import type { ApprovalFlow } from "../types.js";

export const signTypedDataApprovalFlow: ApprovalFlow<typeof ApprovalKinds.SignTypedData> = {
  kind: ApprovalKinds.SignTypedData,
  parseDecision: (input) => parseNoDecision(ApprovalKinds.SignTypedData, input),
  async approve(record, _decision, deps) {
    const payload = record.request;
    const { reviewChainRef } = deriveApprovalReviewContext(record, { request: payload });
    const chainRef = reviewChainRef;

    const signature = await deps.namespaceRuntime.approvals.signTypedData({
      chainRef,
      address: payload.from,
      typedData: payload.typedData,
    });

    return signature;
  },
};
