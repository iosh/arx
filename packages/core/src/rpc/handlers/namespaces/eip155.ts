import { ZodError } from "zod";
import { type ChainMetadata, createEip155MetadataFromEip3085, parseCaip2 } from "../../../chains/index.js";
import {
  ApprovalTypes,
  PermissionScopes,
  type TransactionController,
  type TransactionMeta,
} from "../../../controllers/index.js";
import { evmProviderErrors, evmRpcErrors } from "../../../errors/index.js";
import { lockedResponse } from "../locked.js";
import type { MethodDefinition, MethodHandler } from "../types.js";
import type { NamespaceAdapter } from "./adapter.js";
import {
  buildEip155TransactionRequest,
  createTaskId,
  EIP155_NAMESPACE,
  isRpcError,
  normaliseTypedData,
  resolveProviderErrors,
  resolveRpcErrors,
  resolveSigningInputs,
  toParamsArray,
} from "./utils.js";

type RpcLikeError = Error & { code: number; data?: unknown };

class TransactionResolutionError extends Error {
  readonly meta: TransactionMeta;

  constructor(meta: TransactionMeta) {
    super(meta.error?.message ?? "Transaction failed");
    this.name = "TransactionResolutionError";
    this.meta = meta;
  }
}

const RESOLVED_STATUSES = new Set<TransactionMeta["status"]>(["broadcast", "confirmed"]);
const FAILED_STATUSES = new Set<TransactionMeta["status"]>(["failed", "replaced"]);

const isResolved = (meta: TransactionMeta) => RESOLVED_STATUSES.has(meta.status) && typeof meta.hash === "string";
const isFailed = (meta: TransactionMeta) => FAILED_STATUSES.has(meta.status);

const waitForTransactionBroadcast = async (
  controller: Pick<TransactionController, "getMeta" | "onStatusChanged">,
  id: string,
): Promise<TransactionMeta> => {
  const initial = controller.getMeta(id);
  if (!initial) {
    throw new Error(`Transaction ${id} not found after submission`);
  }
  if (isResolved(initial)) {
    return initial;
  }
  if (isFailed(initial)) {
    throw new TransactionResolutionError(initial);
  }

  return new Promise<TransactionMeta>((resolve, reject) => {
    const unsubscribe = controller.onStatusChanged(({ id: changeId, meta }) => {
      if (changeId !== id) {
        return;
      }

      if (isResolved(meta)) {
        unsubscribe();
        resolve(meta);
        return;
      }

      if (isFailed(meta)) {
        unsubscribe();
        reject(new TransactionResolutionError(meta));
      }
    });
  });
};

const handleEthChainId: MethodHandler = ({ controllers }) => {
  return controllers.network.getActiveChain().chainId;
};

const handleEthAccounts: MethodHandler = ({ controllers }) => {
  const active = controllers.network.getActiveChain();
  return controllers.accounts.getAccounts({ chainRef: active.chainRef });
};

const handleEthRequestAccounts: MethodHandler = async ({ origin, controllers, rpcContext }) => {
  const providerErrors = resolveProviderErrors(controllers, rpcContext);
  const activeChain = controllers.network.getActiveChain();
  const suggested = controllers.accounts.getAccounts({ chainRef: activeChain.chainRef });

  const task = {
    id: createTaskId("eth_requestAccounts"),
    type: ApprovalTypes.RequestAccounts,
    origin,
    namespace: "eip155",
    chainRef: activeChain.chainRef,
    createdAt: Date.now(),
    payload: {
      caip2: activeChain.chainRef,
      suggestedAccounts: [...suggested],
    },
  };

  try {
    return await controllers.approvals.requestApproval(task);
  } catch (error) {
    if (isRpcError(error)) throw error;
    throw providerErrors.userRejectedRequest({
      message: "User rejected account access",
      data: { origin },
    });
  }
};

const handleWalletSwitchEthereumChain: MethodHandler = async ({ request, controllers, rpcContext }) => {
  const rpcErrors = resolveRpcErrors(controllers, rpcContext);
  const providerErrors = resolveProviderErrors(controllers, rpcContext);
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

const handleWalletAddEthereumChain: MethodHandler = async ({ origin, request, controllers, rpcContext }) => {
  const rpcErrors = resolveRpcErrors(controllers, rpcContext);
  const providerErrors = resolveProviderErrors(controllers, rpcContext);
  const paramsArray = toParamsArray(request.params);
  const [raw] = paramsArray;

  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw rpcErrors.invalidParams({
      message: "wallet_addEthereumChain expects a single object parameter",
      data: { params: request.params },
    });
  }

  let metadata: ChainMetadata;
  try {
    metadata = createEip155MetadataFromEip3085(raw);
  } catch (error) {
    const message =
      error instanceof ZodError
        ? "wallet_addEthereumChain received invalid chain parameters"
        : error instanceof Error
          ? error.message
          : "Invalid chain parameters";

    throw rpcErrors.invalidParams({
      message,
      data: { params: request.params },
    });
  }

  if (metadata.namespace !== "eip155") {
    throw providerErrors.custom({
      code: 4902,
      message: "Requested chain is not compatible with wallet_addEthereumChain",
      data: { chainRef: metadata.chainRef },
    });
  }

  const existing = controllers.chainRegistry.getChain(metadata.chainRef);
  if (existing && existing.namespace !== "eip155") {
    throw providerErrors.custom({
      code: 4902,
      message: "Requested chain conflicts with an existing non-EVM chain",
      data: { chainRef: metadata.chainRef },
    });
  }
  const isUpdate = Boolean(existing);

  const task = {
    id: createTaskId("wallet_addEthereumChain"),
    type: ApprovalTypes.AddChain,
    origin,
    namespace: metadata.namespace,
    chainRef: metadata.chainRef,
    createdAt: Date.now(),
    payload: {
      metadata,
      isUpdate,
    },
  };

  try {
    await controllers.approvals.requestApproval(task);
  } catch (error) {
    if (isRpcError(error)) throw error;
    throw providerErrors.userRejectedRequest({
      message: "User rejected chain addition",
      data: { origin },
    });
  }

  return null;
};

const handlePersonalSign: MethodHandler = async ({ origin, request, controllers, rpcContext }) => {
  const paramsArray = toParamsArray(request.params);
  const rpcErrors = resolveRpcErrors(controllers, rpcContext);
  const providerErrors = resolveProviderErrors(controllers, rpcContext);

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

  const activeChain = controllers.network.getActiveChain();

  const task = {
    id: createTaskId("personal_sign"),
    type: ApprovalTypes.SignMessage,
    origin,
    namespace: "eip155",
    chainRef: activeChain.chainRef,
    createdAt: Date.now(),
    payload: {
      caip2: activeChain.chainRef,
      from: address,
      message,
    },
  };

  try {
    const signature = await controllers.approvals.requestApproval(task);

    // Grant Sign permission after successful signature
    await controllers.permissions.grant(origin, PermissionScopes.Sign, {
      namespace: "eip155",
      chainRef: activeChain.chainRef,
    });

    return signature;
  } catch (error) {
    if (isRpcError(error)) throw error;
    throw providerErrors.userRejectedRequest({
      message: "User rejected message signing",
      data: { origin },
    });
  }
};

const handleEthSignTypedDataV4: MethodHandler = async ({ origin, request, controllers, rpcContext }) => {
  const rpcErrors = resolveRpcErrors(controllers, rpcContext);
  const providerErrors = resolveProviderErrors(controllers, rpcContext);
  const paramsArray = toParamsArray(request.params);

  if (paramsArray.length < 2) {
    throw rpcErrors.invalidParams({
      message: "eth_signTypedData_v4 requires address and typed data parameters",
      data: { params: request.params },
    });
  }

  const { address, typedData } = normaliseTypedData(paramsArray, rpcErrors);
  const activeChain = controllers.network.getActiveChain();

  const task = {
    id: createTaskId("eth_signTypedData_v4"),
    type: ApprovalTypes.SignTypedData,
    origin,
    namespace: "eip155",
    chainRef: activeChain.chainRef,
    createdAt: Date.now(),
    payload: {
      caip2: activeChain.chainRef,
      from: address,
      typedData,
    },
  };

  try {
    const signature = await controllers.approvals.requestApproval(task);

    // Grant Sign permission after successful signature
    await controllers.permissions.grant(origin, PermissionScopes.Sign, {
      namespace: "eip155",
      chainRef: activeChain.chainRef,
    });

    return signature;
  } catch (error) {
    if (isRpcError(error)) throw error;
    throw providerErrors.userRejectedRequest({
      message: "User rejected typed data signing",
      data: { origin },
    });
  }
};

const handleEthSendTransaction: MethodHandler = async ({ origin, request, controllers, rpcContext }) => {
  const rpcErrors = resolveRpcErrors(controllers, rpcContext);
  const providerErrors = resolveProviderErrors(controllers, rpcContext);
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
    const broadcastMeta = await waitForTransactionBroadcast(controllers.transactions, meta.id);

    if (typeof broadcastMeta.hash !== "string") {
      throw new TransactionResolutionError(broadcastMeta);
    }

    await controllers.permissions.grant(origin, PermissionScopes.Transaction, {
      namespace: broadcastMeta.namespace,
      chainRef: broadcastMeta.caip2,
    });

    return broadcastMeta.hash;
  } catch (error) {
    if (isRpcError(error)) {
      throw error;
    }

    if (error instanceof TransactionResolutionError) {
      const { meta: failedMeta } = error;

      if (failedMeta.userRejected) {
        throw providerErrors.userRejectedRequest({
          message: "User rejected transaction",
          data: { origin, id: failedMeta.id },
        });
      }

      const failure = failedMeta.error;
      if (failure && typeof failure.code === "number") {
        const rpcLikeError = new Error(failure.message ?? "Transaction failed") as RpcLikeError;
        rpcLikeError.code = failure.code;
        if (failure.data !== undefined) {
          rpcLikeError.data = failure.data;
        }
        throw rpcLikeError;
      }

      throw rpcErrors.internal({
        message: failure?.message ?? "Transaction failed to broadcast",
        data: { origin, id: failedMeta.id, error: failure ?? undefined },
      });
    }

    throw providerErrors.userRejectedRequest({
      message: "User rejected transaction",
      data: { origin },
    });
  }
};

const buildEip155Definitions = (): Record<string, MethodDefinition> => ({
  eth_chainId: {
    handler: handleEthChainId,
  },
  eth_accounts: {
    scope: PermissionScopes.Accounts,
    locked: lockedResponse([]),
    handler: handleEthAccounts,
    isBootstrap: true,
  },
  eth_requestAccounts: {
    scope: PermissionScopes.Accounts,
    approvalRequired: true,
    handler: handleEthRequestAccounts,
    isBootstrap: true,
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
  wallet_addEthereumChain: {
    scope: PermissionScopes.Basic,
    approvalRequired: true,
    handler: handleWalletAddEthereumChain,
  },
});

/**
 * EIP-155 passthrough matrix.
 *
 * - allowedMethods: read-only RPCs forwarded to the RPC node.
 * - allowWhenLocked: read-only RPCs still available when the vault is locked.
 *   Filter APIs excluded from allowWhenLocked due to session state because they manipulate node-side cursors.
 */
const EIP155_PASSTHROUGH_CONFIG: Required<NamespaceAdapter["passthrough"]> = {
  allowedMethods: [
    "eth_blockNumber",
    "eth_syncing",
    "eth_getBlockByNumber",
    "eth_getBlockByHash",
    "eth_getBlockTransactionCountByHash",
    "eth_getBlockTransactionCountByNumber",
    "eth_getUncleCountByBlockHash",
    "eth_getUncleCountByBlockNumber",
    "eth_protocolVersion",
    "eth_getBalance",
    "eth_getTransactionCount",
    "eth_getCode",
    "eth_getStorageAt",
    "eth_call",
    "eth_estimateGas",
    "eth_getTransactionByHash",
    "eth_getTransactionByBlockHashAndIndex",
    "eth_getTransactionByBlockNumberAndIndex",
    "eth_getTransactionReceipt",
    "eth_getLogs",
    "eth_feeHistory",
    "eth_gasPrice",
    "eth_maxPriorityFeePerGas",
    "net_version",
    "net_listening",
    "net_peerCount",
    "web3_clientVersion",
    "eth_newFilter",
    "eth_newBlockFilter",
    "eth_newPendingTransactionFilter",
    "eth_uninstallFilter",
    "eth_getFilterChanges",
    "eth_getFilterLogs",
  ] as const,
  allowWhenLocked: [
    "eth_blockNumber",
    "eth_syncing",
    "eth_getBlockByNumber",
    "eth_getBlockByHash",
    "eth_getBlockTransactionCountByHash",
    "eth_getBlockTransactionCountByNumber",
    "eth_getUncleCountByBlockHash",
    "eth_getUncleCountByBlockNumber",
    "eth_protocolVersion",
    "eth_getBalance",
    "eth_getTransactionCount",
    "eth_getCode",
    "eth_getStorageAt",
    "eth_call",
    "eth_estimateGas",
    "eth_getTransactionByHash",
    "eth_getTransactionByBlockHashAndIndex",
    "eth_getTransactionByBlockNumberAndIndex",
    "eth_getTransactionReceipt",
    "eth_getLogs",
    "eth_feeHistory",
    "eth_gasPrice",
    "eth_maxPriorityFeePerGas",
    "net_version",
    "net_listening",
    "net_peerCount",
    "web3_clientVersion",
  ] as const,
};

export const createEip155Adapter = (): NamespaceAdapter => ({
  namespace: EIP155_NAMESPACE,
  methodPrefixes: ["eth_", "personal_", "wallet_", "net_", "web3_"],
  definitions: buildEip155Definitions(),
  passthrough: EIP155_PASSTHROUGH_CONFIG,
  errors: {
    rpc: evmRpcErrors,
    provider: evmProviderErrors,
  },
});
