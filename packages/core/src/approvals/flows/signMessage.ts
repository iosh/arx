import { ApprovalKinds } from "../../approvals/queue/types.js";
import { deriveApprovalReviewContext, parseNoDecision } from "../shared.js";
import type { ApprovalFlow } from "../types.js";

export const signMessageApprovalFlow: ApprovalFlow<typeof ApprovalKinds.SignMessage> = {
  kind: ApprovalKinds.SignMessage,
  parseDecision: (input) => parseNoDecision(ApprovalKinds.SignMessage, input),
  async approve(record, _decision, deps) {
    const payload = record.request;
    const { reviewChainRef, namespace } = deriveApprovalReviewContext(record, { request: payload });
    const chainRef = reviewChainRef;

    const signature = await deps.namespaceRuntime.approvals.signMessage({
      namespace,
      chainRef,
      address: payload.from,
      message: payload.message,
    });

    return signature;
  },
};
