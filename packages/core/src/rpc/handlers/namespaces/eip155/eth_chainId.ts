import { ArxReasons, arxError } from "@arx/errors";
import type { MethodDefinition } from "../../types.js";
import { toParamsArray } from "../utils.js";

export const ethChainIdDefinition: MethodDefinition = {
  validateParams: (params) => {
    const arr = toParamsArray(params);
    if (arr.length !== 0) {
      throw arxError({
        reason: ArxReasons.RpcInvalidParams,
        message: "eth_chainId does not accept parameters",
        data: { params },
      });
    }
  },
  handler: ({ controllers }) => controllers.network.getActiveChain().chainId,
};
