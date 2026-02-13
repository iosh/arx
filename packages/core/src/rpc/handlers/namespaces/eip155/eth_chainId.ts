import type { MethodDefinition } from "../../types.js";
import { NoParamsSchema } from "../../params.js";

export const ethChainIdDefinition: MethodDefinition<undefined> = {
  paramsSchema: NoParamsSchema,
  handler: ({ controllers }) => controllers.network.getActiveChain().chainId,
};
