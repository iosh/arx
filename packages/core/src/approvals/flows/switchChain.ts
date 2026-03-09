import { ArxReasons, arxError } from "@arx/errors";
import { ApprovalKinds } from "../../controllers/approval/types.js";
import { ProviderChainActivationReasons } from "../../services/runtime/chainActivation/types.js";
import { createApprovalSummaryBase } from "../presentation.js";
import { ApprovalChainDerivationFallbacks, parseNoDecision } from "../shared.js";
import type { ApprovalFlow } from "../types.js";

export const switchChainApprovalFlow: ApprovalFlow<typeof ApprovalKinds.SwitchChain> = {
  kind: ApprovalKinds.SwitchChain,
  parseDecision: (input) => parseNoDecision(ApprovalKinds.SwitchChain, input),
  present(record, deps) {
    const reviewChain = deps.chainViews.getApprovalReviewChainView({
      record,
      request: record.request,
      fallback: ApprovalChainDerivationFallbacks.None,
    });
    const requestedChainRef = reviewChain.chainRef;
    const target = deps.chainViews.findAvailableChainView({ chainRef: requestedChainRef }) ?? reviewChain;

    return {
      ...createApprovalSummaryBase(record, deps, {
        request: record.request,
        fallback: ApprovalChainDerivationFallbacks.None,
      }),
      type: "switchChain",
      payload: {
        chainRef: requestedChainRef,
        chainId: target.chainId,
        displayName: target.displayName,
      },
    };
  },
  async approve(record, _decision, deps) {
    const requested = record.request.chainRef ?? record.chainRef;
    if (!requested) {
      throw arxError({
        reason: ArxReasons.RpcInvalidParams,
        message: "Switch chain approval is missing chainRef",
        data: { id: record.id },
      });
    }

    await deps.chainActivation.activateProviderChain({
      namespace: record.namespace ?? requested.split(":")[0] ?? "",
      chainRef: requested,
      reason: ProviderChainActivationReasons.SwitchChain,
    });
    return null;
  },
};
