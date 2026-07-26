import { ApprovalKinds } from "../../../../approvals/queue/types.js";
import { decodeAddEthereumChainParams } from "../../../../namespaces/eip155/eip3085.js";
import type { CustomNetworkInput } from "../../../../networks/types.js";
import { RpcRequestKinds } from "../../../requestKind.js";
import { lockedQueue } from "../../locked.js";
import { AuthorizationRequirements, AuthorizedScopeChecks } from "../../types.js";
import { defineEip155ApprovalMethod, requestProviderApproval } from "./shared.js";

export const walletAddEthereumChainDefinition = defineEip155ApprovalMethod<CustomNetworkInput>({
  requestKind: RpcRequestKinds.ChainManagement,
  authorizationRequirement: AuthorizationRequirements.None,
  authorizedScopeCheck: AuthorizedScopeChecks.None,
  locked: lockedQueue(),
  parseParams: (params) => decodeAddEthereumChainParams(params, "wallet_addEthereumChain"),
  handler: async (context) => {
    const { params: seed, deps, executionContext } = context;
    const { definition, defaultRpcEndpoints } = seed;
    if (deps.networks.get(definition.chainRef)) return null;

    const approval = await requestProviderApproval({
      deps,
      executionContext,
      method: "wallet_addEthereumChain",
      kind: ApprovalKinds.AddChain,
      chainRef: definition.chainRef,
      request: {
        definition,
        defaultRpcEndpoints,
        isUpdate: false,
      },
    });
    await approval.settled;
    await deps.networks.addCustom(seed);

    return null;
  },
});
