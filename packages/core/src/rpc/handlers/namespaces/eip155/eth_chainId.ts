import { defineNoParamsMethod } from "../../types.js";

export const ethChainIdDefinition = defineNoParamsMethod({
  handler: ({ controllers }) => controllers.network.getActiveChain().chainId,
});
