import { ArxReasons, arxError } from "@arx/errors";
import { ApprovalKinds } from "../../controllers/approval/types.js";
import { createApprovalSummaryBase } from "../presentation.js";
import { deriveApprovalReviewContext, parseNoDecision } from "../shared.js";
import type { ApprovalFlow } from "../types.js";

export const signMessageApprovalFlow: ApprovalFlow<typeof ApprovalKinds.SignMessage> = {
  kind: ApprovalKinds.SignMessage,
  parseDecision: (input) => parseNoDecision(ApprovalKinds.SignMessage, input),
  present(record, deps) {
    return {
      ...createApprovalSummaryBase(record, deps, { request: record.request }),
      type: "signMessage",
      payload: {
        from: String(record.request.from ?? ""),
        message: String(record.request.message ?? ""),
      },
    };
  },
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
