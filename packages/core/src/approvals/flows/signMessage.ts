import { ArxReasons, arxError } from "@arx/errors";
import { ApprovalKinds } from "../../controllers/approval/types.js";
import { deriveApprovalReviewContext, parseNoDecision } from "../shared.js";
import type { ApprovalFlow } from "../types.js";

export const signMessageApprovalFlow: ApprovalFlow<typeof ApprovalKinds.SignMessage> = {
  kind: ApprovalKinds.SignMessage,
  parseDecision: (input) => parseNoDecision(ApprovalKinds.SignMessage, input),
  async approve(record, _decision, deps) {
    const payload = record.request;
    const { reviewChainRef, namespace } = deriveApprovalReviewContext(record, { request: payload });
    const chainRef = reviewChainRef;
    const approvalBindings = deps.namespaceBindings.getApproval(namespace);
    if (!approvalBindings?.signMessage) {
      throw arxError({
        reason: ArxReasons.ChainNotCompatible,
        message: `SignMessage is not supported for namespace "${namespace}".`,
        data: { namespace, chainRef },
      });
    }

    const signature = await approvalBindings.signMessage({
      chainRef,
      address: payload.from,
      message: payload.message,
    });

    return signature;
  },
};
