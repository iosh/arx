import type { WalletApiContext } from "../context.js";

export const getAttentionSnapshot = async (context: WalletApiContext) => {
  return context.attention.getSnapshot();
};
