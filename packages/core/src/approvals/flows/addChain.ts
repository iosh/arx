import { ApprovalKinds } from "../../controllers/approval/types.js";
import { parseNoDecision } from "../shared.js";
import type { ApprovalFlow } from "../types.js";

export const addChainApprovalFlow: ApprovalFlow<typeof ApprovalKinds.AddChain> = {
  kind: ApprovalKinds.AddChain,
  parseDecision: (input) => parseNoDecision(ApprovalKinds.AddChain, input),
  async approve(record, _decision, deps) {
    await deps.chainDefinitions.upsertChain(record.request.metadata);
    return null;
  },
};
