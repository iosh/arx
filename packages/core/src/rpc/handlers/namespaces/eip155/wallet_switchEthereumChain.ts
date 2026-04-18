import { ArxReasons, arxError } from "@arx/errors";
import { ApprovalKinds } from "../../../../controllers/index.js";
import { RpcRequestKinds } from "../../../requestKind.js";
import { lockedQueue } from "../../locked.js";
import { AuthorizationRequirements, AuthorizedScopeChecks } from "../../types.js";
import {
  parseWalletSwitchEthereumChainParams,
  type WalletSwitchEthereumChainParams,
} from "./parseWalletSwitchEthereumChainParams.js";
import { resolveSwitchEthereumChainTarget } from "./resolveSwitchEthereumChainTarget.js";
import { defineEip155ApprovalMethod, requestProviderApproval } from "./shared.js";

export const walletSwitchEthereumChainDefinition = defineEip155ApprovalMethod<WalletSwitchEthereumChainParams>({
  requestKind: RpcRequestKinds.ChainManagement,
  authorizationRequirement: AuthorizationRequirements.None,
  authorizedScopeCheck: AuthorizedScopeChecks.None,
  locked: lockedQueue(),
  parseParams: (params) => parseWalletSwitchEthereumChainParams(params),
  handler: async ({ origin: _origin, params, controllers, rpcContext, invocation }) => {
    const supportedChains = controllers.supportedChains;
    if (!supportedChains) {
      throw arxError({
        reason: ArxReasons.RpcInternal,
        message: "Missing supported chains controller",
      });
    }

    const target = resolveSwitchEthereumChainTarget({
      supportedChains,
      network: controllers.network,
      chainId: params.chainId,
    });

    if (invocation.chainRef === target.chainRef) {
      return null;
    }

    return await requestProviderApproval({
      controllers,
      rpcContext,
      method: "wallet_switchEthereumChain",
      kind: ApprovalKinds.SwitchChain,
      request: {
        chainRef: target.chainRef,
      },
    }).settled;
  },
});
