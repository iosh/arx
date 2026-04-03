import type { AttentionService } from "../../services/runtime/attention/types.js";
import type { WalletAttention } from "../types.js";

// Ephemeral prompts outside the approvals flow.
export const createWalletAttention = (deps: { attention: AttentionService }): WalletAttention => {
  const { attention } = deps;

  return {
    requestAttention: (params) => attention.requestAttention(params),
    getSnapshot: () => attention.getSnapshot(),
    clear: () => attention.clear(),
    clearExpired: () => attention.clearExpired(),
  };
};
