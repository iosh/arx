import { parseCaip2 } from "../../../chains/index.js";
import { ApprovalTypes, PermissionScopes } from "../../../controllers/index.js";
import { lockedResponse } from "../locked.js";
import type { MethodDefinition, MethodHandler } from "../types.js";
import {
  buildEip155TransactionRequest,
  createTaskId,
  isRpcError,
  normaliseTypedData,
  resolveProviderErrors,
  resolveRpcErrors,
  resolveSigningInputs,
  toParamsArray,
} from "./utils.js";

const handleEthChainId: MethodHandler = ({ controllers }) => {
  return controllers.network.getActiveChain().chainId;
};

const handleEthAccounts: MethodHandler = ({ controllers }) => {
  const active = controllers.network.getActiveChain();
  return controllers.accounts.getAccounts({ chainRef: active.chainRef });
};

const handleEthRequestAccounts: MethodHandler = async ({ origin, controllers }) => {
  const providerErrors = resolveProviderErrors(controllers);
  const activeChain = controllers.network.getActiveChain();
  const suggested = controllers.accounts.getAccounts({ chainRef: activeChain.chainRef });

  const task = {
    id: createTaskId("eth_requestAccounts"),
    type: ApprovalTypes.RequestAccounts,
    origin,
    payload: {
      caip2: activeChain.chainRef,
      suggestedAccounts: [...suggested],
    },
  } as const;

  try {
    const approved = await controllers.approvals.requestApproval(task, async () => {
      const result = await controllers.accounts.requestAccounts({
        origin,
        chainRef: activeChain.chainRef,
      });
      if (result.length > 0) {
        await controllers.permissions.grant(origin, PermissionScopes.Basic);
        await controllers.permissions.grant(origin, PermissionScopes.Accounts);
      }
      return result;
    });
    return approved;
  } catch (error) {
    if (isRpcError(error)) throw error;
    throw providerErrors.userRejectedRequest({
      message: "User rejected account access",
      data: { origin },
    });
  }
};

const handleWalletSwitchEthereumChain: MethodHandler = async ({ request, controllers }) => {
  const rpcErrors = resolveRpcErrors(controllers);
  const providerErrors = resolveProviderErrors(controllers);
  const params = request.params;
  const [first] = Array.isArray(params) ? params : params ? [params] : [];

  if (!first || typeof first !== "object" || Array.isArray(first)) {
    throw rpcErrors.invalidParams({
      message: "wallet_switchEthereumChain expects a single object parameter",
      data: { params },
    });
  }

  const payload = first as Record<string, unknown>;
  const rawChainId = typeof payload.chainId === "string" ? payload.chainId.trim() : undefined;
  const rawCaip2 = typeof payload.caip2 === "string" ? payload.caip2.trim() : undefined;

  if (!rawChainId && !rawCaip2) {
    throw rpcErrors.invalidParams({
      message: "wallet_switchEthereumChain requires a chainId or caip2 value",
      data: { params },
    });
  }

  const normalizedChainId = rawChainId?.toLowerCase();
  if (normalizedChainId && !/^0x[0-9a-f]+$/i.test(normalizedChainId)) {
    throw rpcErrors.invalidParams({
      message: "wallet_switchEthereumChain received an invalid hex chainId",
      data: { chainId: rawChainId },
    });
  }

  let normalizedCaip2: string | undefined;
  if (rawCaip2) {
    try {
      const parsed = parseCaip2(rawCaip2);
      if (parsed.namespace !== "eip155") {
        throw providerErrors.custom({
          code: 4902,
          message: "Requested chain is not compatible with wallet_switchEthereumChain",
          data: { caip2: rawCaip2 },
        });
      }
      if (normalizedChainId) {
        const decimal = BigInt(normalizedChainId).toString(10);
        if (decimal !== parsed.reference) {
          throw rpcErrors.invalidParams({
            message: "wallet_switchEthereumChain chainId does not match caip2 reference",
            data: { chainId: rawChainId, caip2: rawCaip2 },
          });
        }
      }
      normalizedCaip2 = `${parsed.namespace}:${parsed.reference}`;
    } catch (error) {
      if (isRpcError(error)) throw error;
      throw rpcErrors.invalidParams({
        message: "wallet_switchEthereumChain received an invalid caip2 identifier",
        data: { caip2: rawCaip2 },
      });
    }
  }

  const state = controllers.network.getState();
  const target = state.knownChains.find((item) => {
    if (normalizedCaip2 && item.chainRef === normalizedCaip2) return true;
    if (normalizedChainId) {
      const candidateChainId = typeof item.chainId === "string" ? item.chainId.toLowerCase() : null;
      if (candidateChainId && candidateChainId === normalizedChainId) return true;
    }
    return false;
  });

  if (!target) {
    throw providerErrors.custom({
      code: 4902,
      message: "Requested chain is not registered with ARX",
      data: { chainId: rawChainId, caip2: rawCaip2 },
    });
  }

  if (target.namespace !== "eip155") {
    throw providerErrors.custom({
      code: 4902,
      message: "Requested chain is not compatible with wallet_switchEthereumChain",
      data: { chainRef: target.chainRef },
    });
  }

  const supportsFeature = target.features?.includes("wallet_switchEthereumChain") ?? false;
  if (!supportsFeature) {
    throw providerErrors.custom({
      code: 4902,
      message: "Requested chain does not support wallet_switchEthereumChain",
      data: { chainRef: target.chainRef },
    });
  }

  try {
    await controllers.network.switchChain(target.chainRef);
    return null;
  } catch (error) {
    if (error instanceof Error && /unknown chain/i.test(error.message)) {
      throw providerErrors.custom({
        code: 4902,
        message: error.message,
        data: { chainId: rawChainId ?? target.chainId, caip2: normalizedCaip2 ?? target.chainRef },
      });
    }
    throw error;
  }
};

const handlePersonalSign: MethodHandler = async ({ origin, request, controllers }) => {
  const paramsArray = toParamsArray(request.params);

  const rpcErrors = resolveRpcErrors(controllers);

  const providerErrors = resolveProviderErrors(controllers);
  if (paramsArray.length < 2) {
    throw rpcErrors.invalidParams({
      message: "personal_sign requires message and account parameters",
      data: { params: request.params },
    });
  }

  const { address, message } = resolveSigningInputs(paramsArray);

  if (!address) {
    throw rpcErrors.invalidParams({
      message: "personal_sign expects an account address parameter",
      data: { params: request.params },
    });
  }

  if (!message) {
    throw rpcErrors.invalidParams({
      message: "personal_sign expects a message parameter",
      data: { params: request.params },
    });
  }

  const task = {
    id: createTaskId("personal_sign"),
    type: ApprovalTypes.SignMessage,
    origin,
    payload: {
      caip2: controllers.network.getActiveChain().chainRef,
      from: address,
      message,
    },
  } as const;

  try {
    return await controllers.approvals.requestApproval(task);
  } catch (error) {
    if (isRpcError(error)) throw error;
    throw providerErrors.userRejectedRequest({
      message: "User rejected message signing",
      data: { origin },
    });
  }
};

const handleEthSignTypedDataV4: MethodHandler = async ({ origin, request, controllers }) => {
  const rpcErrors = resolveRpcErrors(controllers);
  const providerErrors = resolveProviderErrors(controllers);
  const paramsArray = toParamsArray(request.params);

  if (paramsArray.length < 2) {
    throw rpcErrors.invalidParams({
      message: "eth_signTypedData_v4 requires address and typed data parameters",
      data: { params: request.params },
    });
  }

  const { address, typedData } = normaliseTypedData(paramsArray, rpcErrors);

  const task = {
    id: createTaskId("eth_signTypedData_v4"),
    type: ApprovalTypes.SignTypedData,
    origin,
    payload: {
      caip2: controllers.network.getActiveChain().chainRef,
      from: address,
      typedData,
    },
  } as const;

  try {
    return await controllers.approvals.requestApproval(task);
  } catch (error) {
    if (isRpcError(error)) throw error;
    throw providerErrors.userRejectedRequest({
      message: "User rejected typed data signing",
      data: { origin },
    });
  }
};

const handleEthSendTransaction: MethodHandler = async ({ origin, request, controllers }) => {
  const rpcErrors = resolveRpcErrors(controllers);
  const providerErrors = resolveProviderErrors(controllers);
  const paramsArray = toParamsArray(request.params);

  if (paramsArray.length === 0) {
    throw rpcErrors.invalidParams({
      message: "eth_sendTransaction requires at least one transaction parameter",
      data: { params: request.params },
    });
  }

  const activeChain = controllers.network.getActiveChain();
  const txRequest = buildEip155TransactionRequest(paramsArray, rpcErrors, activeChain.chainRef);

  try {
    const meta = await controllers.transactions.submitTransaction(origin, txRequest);
    return meta.id;
  } catch (error) {
    if (isRpcError(error)) throw error;
    throw providerErrors.userRejectedRequest({
      message: "User rejected transaction",
      data: { origin },
    });
  }
};

export const buildEip155Definitions = (): Record<string, MethodDefinition> => ({
  eth_chainId: {
    handler: handleEthChainId,
  },
  eth_accounts: {
    scope: PermissionScopes.Accounts,
    locked: lockedResponse([]),
    handler: handleEthAccounts,
  },
  eth_requestAccounts: {
    scope: PermissionScopes.Accounts,
    approvalRequired: true,
    handler: handleEthRequestAccounts,
  },

  wallet_switchEthereumChain: {
    scope: PermissionScopes.Basic,
    handler: handleWalletSwitchEthereumChain,
  },
  personal_sign: {
    scope: PermissionScopes.Sign,
    approvalRequired: true,
    handler: handlePersonalSign,
  },

  eth_signTypedData_v4: {
    scope: PermissionScopes.Sign,
    approvalRequired: true,
    handler: handleEthSignTypedDataV4,
  },
  eth_sendTransaction: {
    scope: PermissionScopes.Transaction,
    approvalRequired: true,
    handler: handleEthSendTransaction,
  },
});
