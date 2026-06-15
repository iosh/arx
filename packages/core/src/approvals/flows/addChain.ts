import { ApprovalKinds } from "../../approvals/queue/types.js";
import { parseNoDecision } from "../shared.js";
import type { ApprovalFlow } from "../types.js";

export const addChainApprovalFlow: ApprovalFlow<typeof ApprovalKinds.AddChain> = {
  kind: ApprovalKinds.AddChain,
  parseDecision: (input) => parseNoDecision(ApprovalKinds.AddChain, input),
  async approve(record, _decision, deps) {
    await deps.supportedChains.addChain(record.request.definition, { createdByOrigin: record.origin });
    await deps.chainRpcDefaultEndpoints.setDefaultEndpoints(
      record.request.definition.chainRef,
      record.request.defaultRpcEndpoints,
      "request",
    );
    return null;
  },
};
