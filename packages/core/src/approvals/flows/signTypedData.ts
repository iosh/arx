import { ApprovalKinds } from "../../approvals/queue/types.js";
import { ChainNotCompatibleError } from "../../chains/errors.js";
import { deriveApprovalReviewContext, parseNoDecision } from "../shared.js";
import type { ApprovalFlow } from "../types.js";

export const signTypedDataApprovalFlow: ApprovalFlow<typeof ApprovalKinds.SignTypedData> = {
  kind: ApprovalKinds.SignTypedData,
  parseDecision: (input) => parseNoDecision(ApprovalKinds.SignTypedData, input),
  async approve(record, _decision, deps) {
    const payload = record.request;
    const { reviewChainRef, namespace } = deriveApprovalReviewContext(record, { request: payload });
    const chainRef = reviewChainRef;
    const approvalBindings = deps.namespaceBindings.getApproval(namespace);
    if (!approvalBindings?.signTypedData) {
      throw new ChainNotCompatibleError({
        message: `SignTypedData is not supported for namespace "${namespace}".`,
      });
    }

    const signature = await approvalBindings.signTypedData({
      chainRef,
      address: payload.from,
      typedData: payload.typedData,
    });

    return signature;
  },
};
