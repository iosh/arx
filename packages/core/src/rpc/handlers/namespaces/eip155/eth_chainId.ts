import { parseChainRef } from "../../../../networks/chainRef.js";
import { RpcInvalidRequestError } from "../../../errors.js";
import {
  ApprovalRequirements,
  AuthorizationRequirements,
  AuthorizedScopeChecks,
  defineNoParamsMethod,
} from "../../types.js";

export const ethChainIdDefinition = defineNoParamsMethod({
  authorizationRequirement: AuthorizationRequirements.None,
  approvalRequirement: ApprovalRequirements.None,
  authorizedScopeCheck: AuthorizedScopeChecks.None,
  handler: ({ invocation }) => {
    const { reference } = parseChainRef(invocation.chainRef);
    if (!/^\d+$/.test(reference)) {
      throw new RpcInvalidRequestError({
        message: "Invalid eip155 chainRef reference",
      });
    }
    return `0x${BigInt(reference).toString(16)}`.toLowerCase();
  },
});
