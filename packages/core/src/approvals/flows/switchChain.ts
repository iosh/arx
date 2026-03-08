import { ArxReasons, arxError } from "@arx/errors";
import { ApprovalKinds } from "../../controllers/approval/types.js";
import { createApprovalSummaryBase } from "../presentation.js";
import { parseNoDecision } from "../shared.js";
import type { ApprovalFlow } from "../types.js";

export const switchChainApprovalFlow: ApprovalFlow<typeof ApprovalKinds.SwitchChain> = {
  kind: ApprovalKinds.SwitchChain,
  parseDecision: (input) => parseNoDecision(ApprovalKinds.SwitchChain, input),
  present(record, deps) {
    const activeChain = deps.chainViews.getActiveChainView();
    const requestedChainRef = record.request.chainRef ?? record.chainRef ?? activeChain.chainRef;
    const target = deps.chainViews.findAvailableChainView({ chainRef: requestedChainRef }) ?? activeChain;

    return {
      ...createApprovalSummaryBase(record, deps),
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

    await deps.network.switchChain(requested);
    await deps.networkPreferences.setActiveChainRef(requested);
    return null;
  },
};
