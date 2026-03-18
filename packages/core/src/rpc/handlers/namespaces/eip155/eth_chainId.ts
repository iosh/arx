import { ArxReasons, arxError } from "@arx/errors";
import { parseChainRef } from "../../../../chains/caip.js";
import {
  ApprovalRequirements,
  AuthorizedScopeChecks,
  ConnectionRequirements,
  defineNoParamsMethod,
} from "../../types.js";

export const ethChainIdDefinition = defineNoParamsMethod({
  connectionRequirement: ConnectionRequirements.None,
  approvalRequirement: ApprovalRequirements.None,
  authorizedScopeCheck: AuthorizedScopeChecks.None,
  handler: ({ invocation }) => {
    const { reference } = parseChainRef(invocation.chainRef);
    if (!/^\d+$/.test(reference)) {
      throw arxError({
        reason: ArxReasons.RpcInvalidRequest,
        message: "Invalid eip155 chainRef reference",
        data: { chainRef: invocation.chainRef, reference },
      });
    }
    return `0x${BigInt(reference).toString(16)}`.toLowerCase();
  },
});
