import type { WalletAttention } from "../../engine/types.js";

export const createAttentionHandlers = (attention: Pick<WalletAttention, "getSnapshot">) => ({
  getSnapshot: async () => attention.getSnapshot(),
});
