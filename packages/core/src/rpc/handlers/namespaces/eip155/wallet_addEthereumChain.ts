import { ZodError } from "zod";
import { ApprovalKinds } from "../../../../approvals/queue/types.js";
import { createEip155DefinitionSeedFromEip3085 } from "../../../../chains/index.js";
import { isSameChainDefinition } from "../../../../networks/definition.js";
import { BuiltinNetworkConflictError } from "../../../../networks/errors.js";
import type { CustomNetworkInput, NonEmptyRpcEndpoints } from "../../../../networks/types.js";
import { RpcInvalidParamsError } from "../../../errors.js";
import { RpcRequestKinds } from "../../../requestKind.js";
import { lockedQueue } from "../../locked.js";
import { AuthorizationRequirements, AuthorizedScopeChecks } from "../../types.js";
import { toParamsArray } from "../utils.js";
import { defineEip155ApprovalMethod, requestProviderApproval } from "./shared.js";

const areRpcEndpointsEqual = (left: NonEmptyRpcEndpoints, right: NonEmptyRpcEndpoints): boolean =>
  left.length === right.length && left.every((endpoint, index) => endpoint === right[index]);

export const walletAddEthereumChainDefinition = defineEip155ApprovalMethod<CustomNetworkInput>({
  requestKind: RpcRequestKinds.ChainManagement,
  authorizationRequirement: AuthorizationRequirements.None,
  authorizedScopeCheck: AuthorizedScopeChecks.None,
  locked: lockedQueue(),
  parseParams: (params) => {
    const [raw] = toParamsArray(params);
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
      throw new RpcInvalidParamsError({
        message: "wallet_addEthereumChain expects a single object parameter",
      });
    }
    try {
      return createEip155DefinitionSeedFromEip3085(raw);
    } catch (error) {
      const message =
        error instanceof ZodError
          ? "wallet_addEthereumChain received invalid chain parameters"
          : error instanceof Error
            ? error.message
            : "Invalid chain parameters";
      throw new RpcInvalidParamsError({
        message,
        details: {
          expected: "EIP-3085 chain metadata",
        },
      });
    }
  },
  handler: async (context) => {
    const { params: seed, deps, executionContext } = context;
    const { definition, defaultRpcEndpoints } = seed;
    const existing = deps.networks.get(definition.chainRef);
    const rpcConfiguration = existing ? deps.networks.getRpcConfiguration(definition.chainRef) : null;
    const isUpdate = existing?.source === "custom";
    const existingDefaultEndpoints =
      rpcConfiguration?.source === "override" ? rpcConfiguration.defaultEndpoints : rpcConfiguration?.endpoints;

    if (
      existing &&
      isSameChainDefinition(existing, definition) &&
      existingDefaultEndpoints &&
      areRpcEndpointsEqual(existingDefaultEndpoints, defaultRpcEndpoints)
    ) {
      return null;
    }
    if (existing?.source === "builtin") throw new BuiltinNetworkConflictError(definition.chainRef);

    const approval = await requestProviderApproval({
      deps,
      executionContext,
      method: "wallet_addEthereumChain",
      kind: ApprovalKinds.AddChain,
      chainRef: definition.chainRef,
      request: {
        definition,
        defaultRpcEndpoints,
        isUpdate,
      },
    });
    await approval.settled;
    if (isUpdate) {
      await deps.networks.updateCustom(seed);
    } else {
      await deps.networks.addCustom(seed);
    }

    return null;
  },
});
