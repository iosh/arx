import { ZodError } from "zod";
import { ApprovalKinds } from "../../../../approvals/index.js";
import { ChainNotCompatibleError, ChainNotSupportedError } from "../../../../chains/errors.js";
import { type CustomChainInput, createEip155DefinitionSeedFromEip3085 } from "../../../../chains/index.js";
import { areRpcEndpointsEqual } from "../../../../chains/rpc/config.js";
import { EIP155_NAMESPACE } from "../../../../namespaces/eip155/constants.js";
import { parseChainRef } from "../../../../networks/chainRef.js";
import { isSameChainDefinition } from "../../../../networks/definition.js";
import { RpcInvalidParamsError } from "../../../errors.js";
import { RpcRequestKinds } from "../../../requestKind.js";
import { lockedQueue } from "../../locked.js";
import { AuthorizationRequirements, AuthorizedScopeChecks } from "../../types.js";
import { toParamsArray } from "../utils.js";
import { defineEip155ApprovalMethod, requestProviderApproval } from "./shared.js";

export const walletAddEthereumChainDefinition = defineEip155ApprovalMethod<CustomChainInput>({
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
    if (parseChainRef(definition.chainRef).namespace !== EIP155_NAMESPACE) {
      throw new ChainNotCompatibleError("Requested chain is not compatible with wallet_addEthereumChain");
    }

    const existing = deps.chainDefinitions.getChain(definition.chainRef);
    if (existing && existing.namespace !== EIP155_NAMESPACE) {
      throw new ChainNotCompatibleError("Requested chain conflicts with an existing non-EVM chain");
    }

    if (existing?.source === "builtin") {
      const definitionMatches = isSameChainDefinition(existing.definition, definition);
      if (!definitionMatches) {
        throw new ChainNotSupportedError("Requested chain conflicts with a builtin chain definition");
      }
    }

    const isUpdate = existing?.source === "custom";
    const existingDefaultEndpoints = deps.chainRpcDefaultEndpoints?.readDefaultEndpoints(definition.chainRef) ?? null;

    if (
      existing &&
      isSameChainDefinition(existing.definition, definition) &&
      existingDefaultEndpoints &&
      areRpcEndpointsEqual(existingDefaultEndpoints, defaultRpcEndpoints)
    ) {
      return null;
    }

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
    await deps.chainRpcDefaultEndpoints?.setDefaultEndpoints(definition.chainRef, defaultRpcEndpoints, "request");
    await deps.chainDefinitions.upsertCustomChain(definition, { createdByOrigin: context.origin });

    return null;
  },
});
