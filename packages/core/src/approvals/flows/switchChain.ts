import { ApprovalKinds } from "../../controllers/approval/types.js";
import { NamespaceChainActivationReasons } from "../../services/runtime/chainActivation/types.js";
import { deriveApprovalReviewContext, parseNoDecision } from "../shared.js";
import type { ApprovalFlow } from "../types.js";

export const switchChainApprovalFlow: ApprovalFlow<typeof ApprovalKinds.SwitchChain> = {
  kind: ApprovalKinds.SwitchChain,
  parseDecision: (input) => parseNoDecision(ApprovalKinds.SwitchChain, input),
  async approve(record, _decision, deps) {
    const { reviewChainRef, namespace } = deriveApprovalReviewContext(record, { request: record.request });
    await deps.chainActivation.activateNamespaceChain({
      namespace,
      chainRef: reviewChainRef,
      reason: NamespaceChainActivationReasons.SwitchChain,
    });
    return null;
  },
};
