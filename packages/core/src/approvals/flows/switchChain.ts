import { ApprovalKinds } from "../../controllers/approval/types.js";
import { ProviderChainActivationReasons } from "../../services/runtime/chainActivation/types.js";
import { createApprovalSummaryBase } from "../presentation.js";
import { deriveApprovalReviewContext, parseNoDecision } from "../shared.js";
import type { ApprovalFlow } from "../types.js";

export const switchChainApprovalFlow: ApprovalFlow<typeof ApprovalKinds.SwitchChain> = {
  kind: ApprovalKinds.SwitchChain,
  parseDecision: (input) => parseNoDecision(ApprovalKinds.SwitchChain, input),
  present(record, deps) {
    const reviewChain = deps.chainViews.getApprovalReviewChainView({
      record,
      request: record.request,
    });
    const requestedChainRef = reviewChain.chainRef;
    const target = deps.chainViews.findAvailableChainView({ chainRef: requestedChainRef }) ?? reviewChain;

    return {
      ...createApprovalSummaryBase(record, deps, { request: record.request }),
      type: "switchChain",
      payload: {
        chainRef: requestedChainRef,
        chainId: target.chainId,
        displayName: target.displayName,
      },
    };
  },
  async approve(record, _decision, deps) {
    const { reviewChainRef, namespace } = deriveApprovalReviewContext(record, { request: record.request });
    await deps.chainActivation.activateProviderChain({
      namespace,
      chainRef: reviewChainRef,
      reason: ProviderChainActivationReasons.SwitchChain,
    });
    return null;
  },
};
