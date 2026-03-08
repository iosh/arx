import { ApprovalKinds } from "../../controllers/approval/types.js";
import { createApprovalSummaryBase } from "../presentation.js";
import { parseNoDecision } from "../shared.js";
import type { ApprovalFlow } from "../types.js";

export const addChainApprovalFlow: ApprovalFlow<typeof ApprovalKinds.AddChain> = {
  kind: ApprovalKinds.AddChain,
  parseDecision: (input) => parseNoDecision(ApprovalKinds.AddChain, input),
  present(record, deps) {
    const meta = record.request.metadata;
    const rpcUrls = Array.from(new Set(meta.rpcEndpoints.map((entry) => entry.url.trim()).filter(Boolean)));
    const blockExplorerUrl =
      meta.blockExplorers?.find((entry) => entry.type === "default")?.url ?? meta.blockExplorers?.[0]?.url;

    return {
      ...createApprovalSummaryBase(record, deps),
      type: "addChain",
      payload: {
        chainRef: meta.chainRef,
        chainId: meta.chainId,
        displayName: meta.displayName,
        rpcUrls,
        nativeCurrency: meta.nativeCurrency
          ? {
              name: meta.nativeCurrency.name,
              symbol: meta.nativeCurrency.symbol,
              decimals: meta.nativeCurrency.decimals,
            }
          : undefined,
        blockExplorerUrl,
        isUpdate: record.request.isUpdate,
      },
    };
  },
  async approve(record, _decision, deps) {
    await deps.chainDefinitions.upsertChain(record.request.metadata);
    return null;
  },
};
