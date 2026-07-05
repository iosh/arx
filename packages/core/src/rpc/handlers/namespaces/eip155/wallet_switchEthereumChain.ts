import { ApprovalKinds } from "../../../../approvals/index.js";
import { NamespaceChainActivationReasons } from "../../../../services/runtime/chainActivation/types.js";
import * as Hex from "../../../../utils/hex.js";
import { RpcInternalError, RpcInvalidParamsError } from "../../../errors.js";
import { RpcRequestKinds } from "../../../requestKind.js";
import { lockedQueue } from "../../locked.js";
import { AuthorizationRequirements, AuthorizedScopeChecks } from "../../types.js";
import { toParamsArray } from "../utils.js";
import { resolveSwitchEthereumChainTarget } from "./resolveSwitchEthereumChainTarget.js";
import { defineEip155ApprovalMethod, requestProviderApproval } from "./shared.js";

type SwitchEthereumChainParams = {
  chainId: Hex.Hex;
};

const isRecord = (value: unknown): value is Record<string, unknown> => {
  return typeof value === "object" && value !== null && !Array.isArray(value);
};

const createInvalidParamsError = (
  message: string,
  input: { details?: Record<string, string> | undefined; cause?: unknown } = {},
) => {
  return new RpcInvalidParamsError({
    message,
    details: input.details,
    cause: input.cause,
  });
};

const readChainIdHex = (value: unknown): Hex.Hex => {
  if (typeof value !== "string") {
    throw createInvalidParamsError("wallet_switchEthereumChain expects chainId to be a hex string", {
      details: {
        field: "chainId",
        expected: "hex string",
      },
    });
  }

  try {
    return Hex.fromNumber(Hex.toBigInt(value));
  } catch (error) {
    throw createInvalidParamsError("wallet_switchEthereumChain received an invalid hex chainId", {
      details: {
        field: "chainId",
        expected: "hex string",
      },
      cause: error,
    });
  }
};

const readSwitchEthereumChainParams = (params: unknown): SwitchEthereumChainParams => {
  const paramsArray = toParamsArray(params);
  const payload = paramsArray[0];
  if (paramsArray.length !== 1 || !isRecord(payload)) {
    throw createInvalidParamsError("wallet_switchEthereumChain expects a single object parameter with chainId");
  }

  const keys = Object.keys(payload);
  if (keys.length !== 1 || keys[0] !== "chainId") {
    throw createInvalidParamsError("wallet_switchEthereumChain expects exactly one chainId field", {
      details: {
        field: "chainId",
        expected: "only field",
      },
    });
  }

  return {
    chainId: readChainIdHex(payload.chainId),
  };
};

export const walletSwitchEthereumChainDefinition = defineEip155ApprovalMethod<SwitchEthereumChainParams>({
  requestKind: RpcRequestKinds.ChainManagement,
  authorizationRequirement: AuthorizationRequirements.None,
  authorizedScopeCheck: AuthorizedScopeChecks.None,
  locked: lockedQueue(),
  parseParams: readSwitchEthereumChainParams,
  handler: async (context) => {
    const { params, deps, executionContext, invocation } = context;
    const chainDefinitions = deps.chainDefinitions;
    if (!chainDefinitions) {
      throw new RpcInternalError({
        message: "Missing chain definitions service",
      });
    }

    const target = resolveSwitchEthereumChainTarget({
      chainDefinitions,
      chainRpc: deps.chainRpc,
      chainId: params.chainId,
    });

    if (invocation.chainRef === target.chainRef) {
      return null;
    }

    const approval = await requestProviderApproval({
      deps,
      executionContext,
      method: "wallet_switchEthereumChain",
      kind: ApprovalKinds.SwitchChain,
      chainRef: target.chainRef,
      request: {
        chainRef: target.chainRef,
      },
    });
    await approval.settled;
    await deps.chainActivation.selectProviderChain({
      origin: context.origin,
      namespace: invocation.namespace,
      chainRef: target.chainRef,
      reason: NamespaceChainActivationReasons.SwitchChain,
    });
    return null;
  },
});
