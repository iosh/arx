import { ArxReasons, arxError, isArxError } from "@arx/errors";
import type { JsonRpcParams } from "@metamask/utils";
import { ZodError } from "zod";
import type { ChainRef } from "../../../chains/ids.js";
import {
  type ChainMetadata,
  createDefaultChainModuleRegistry,
  createEip155MetadataFromEip3085,
  parseChainRef,
} from "../../../chains/index.js";
import {
  type ApprovalTask,
  ApprovalTypes,
  type PermissionApprovalResult,
  type PermissionRequestDescriptor,
  type PermissionScope,
  PermissionScopes,
  type RequestPermissionsApprovalPayload,
  type TransactionController,
  type TransactionMeta,
} from "../../../controllers/index.js";
import { buildWalletPermissions, PERMISSION_SCOPE_CAPABILITIES } from "../../permissions.js";
import { lockedAllow, lockedResponse } from "../locked.js";
import type { MethodDefinition, MethodHandler, RpcInvocationContext } from "../types.js";
import type { NamespaceAdapter } from "./adapter.js";
import {
  buildEip155TransactionRequest,
  createTaskId,
  deriveSigningInputs,
  EIP155_NAMESPACE,
  isDomainError,
  isRpcError,
  parseTypedDataParams,
  toParamsArray,
} from "./utils.js";

const CAPABILITY_TO_SCOPE = new Map(
  Object.entries(PERMISSION_SCOPE_CAPABILITIES).map(([scope, capability]) => [capability, scope as PermissionScope]),
);
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

const requireRequestContext = (rpcContext: RpcInvocationContext | undefined, method: string) => {
  const requestContext = rpcContext?.requestContext;
  if (!requestContext) {
    throw arxError({
      reason: ArxReasons.RpcInvalidRequest,
      message: `Missing request context for ${method}.`,
      data: { method },
    });
  }
  return requestContext;
};

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

const handleEthAccounts: MethodHandler = ({ origin, controllers }) => {
  const active = controllers.network.getActiveChain();
  const accounts = controllers.permissions.getPermittedAccounts(origin, {
    namespace: EIP155_NAMESPACE,
    chainRef: active.chainRef,
  });

  const chains = createDefaultChainModuleRegistry();
  return accounts.map((canonical) => chains.formatAddress({ chainRef: active.chainRef, canonical }));
};

const handleEthRequestAccounts: MethodHandler = async ({ origin, controllers, rpcContext }) => {
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
      chainRef: activeChain.chainRef,
      suggestedAccounts: [...suggested],
    },
  };

  try {
    return await controllers.approvals.requestApproval(task, requireRequestContext(rpcContext, "eth_requestAccounts"));
  } catch (error) {
    if (isDomainError(error) || isRpcError(error)) throw error;
    throw arxError({
      reason: ArxReasons.ApprovalRejected,
      message: "User rejected account access",
      data: { origin },
      cause: error,
    });
  }
};

const handleWalletSwitchEthereumChain: MethodHandler = async ({ request, controllers, rpcContext }) => {
  const params = request.params;
  const [first] = Array.isArray(params) ? params : params ? [params] : [];

  if (!first || typeof first !== "object" || Array.isArray(first)) {
    throw arxError({
      reason: ArxReasons.RpcInvalidParams,
      message: "wallet_switchEthereumChain expects a single object parameter",
      data: { params },
    });
  }

  const payload = first as Record<string, unknown>;
  const rawChainId = typeof payload.chainId === "string" ? payload.chainId.trim() : undefined;
  const rawChainRef = typeof payload.chainRef === "string" ? payload.chainRef.trim() : undefined;

  if (!rawChainId && !rawChainRef) {
    throw arxError({
      reason: ArxReasons.RpcInvalidParams,
      message: "wallet_switchEthereumChain requires a chainId or chainRef value",
      data: { params },
    });
  }

  const normalizedChainId = rawChainId?.toLowerCase();
  if (normalizedChainId && !/^0x[0-9a-f]+$/i.test(normalizedChainId)) {
    throw arxError({
      reason: ArxReasons.RpcInvalidParams,
      message: "wallet_switchEthereumChain received an invalid hex chainId",
      data: { chainId: rawChainId },
    });
  }

  let normalizedChainRef: string | undefined;
  if (rawChainRef) {
    try {
      const parsed = parseChainRef(rawChainRef);
      if (parsed.namespace !== "eip155") {
        throw arxError({
          reason: ArxReasons.ChainNotCompatible,
          message: "Requested chain is not compatible with wallet_switchEthereumChain",
          data: { chainRef: rawChainRef },
        });
      }
      if (normalizedChainId) {
        const decimal = BigInt(normalizedChainId).toString(10);
        if (decimal !== parsed.reference) {
          throw arxError({
            reason: ArxReasons.RpcInvalidParams,
            message: "wallet_switchEthereumChain chainId does not match chainRef reference",
            data: { chainId: rawChainId, chainRef: rawChainRef },
          });
        }
      }
      normalizedChainRef = `${parsed.namespace}:${parsed.reference}`;
    } catch (error) {
      if (isDomainError(error) || isRpcError(error)) throw error;
      throw arxError({
        reason: ArxReasons.RpcInvalidParams,
        message: "wallet_switchEthereumChain received an invalid chainRef identifier",
        data: { chainRef: rawChainRef },
        cause: error,
      });
    }
  }

  const state = controllers.network.getState();
  const target = state.knownChains.find((item) => {
    if (normalizedChainRef && item.chainRef === normalizedChainRef) return true;
    if (normalizedChainId) {
      const candidateChainId = typeof item.chainId === "string" ? item.chainId.toLowerCase() : null;
      if (candidateChainId && candidateChainId === normalizedChainId) return true;
    }
    return false;
  });

  if (!target) {
    throw arxError({
      reason: ArxReasons.ChainNotFound,
      message: "Requested chain is not registered with ARX",
      data: { chainId: rawChainId, chainRef: rawChainRef },
    });
  }

  if (target.namespace !== "eip155") {
    throw arxError({
      reason: ArxReasons.ChainNotCompatible,
      message: "Requested chain is not compatible with wallet_switchEthereumChain",
      data: { chainRef: target.chainRef },
    });
  }

  const supportsFeature = target.features?.includes("wallet_switchEthereumChain") ?? false;
  if (!supportsFeature) {
    throw arxError({
      reason: ArxReasons.ChainNotSupported,
      message: "Requested chain does not support wallet_switchEthereumChain",
      data: { chainRef: target.chainRef },
    });
  }

  try {
    await controllers.network.switchChain(target.chainRef);
    return null;
  } catch (error) {
    if (error instanceof Error && /unknown chain/i.test(error.message)) {
      throw arxError({
        reason: ArxReasons.ChainNotFound,
        message: error.message,
        data: { chainId: rawChainId ?? target.chainId, chainRef: normalizedChainRef ?? target.chainRef },
        cause: error,
      });
    }
    if (isArxError(error)) throw error;
    throw arxError({
      reason: ArxReasons.RpcInternal,
      message: error instanceof Error ? error.message : "Failed to switch chain",
      data: { chainRef: target.chainRef },
      cause: error,
    });
  }
};

const handleWalletAddEthereumChain: MethodHandler = async ({ origin, request, controllers, rpcContext }) => {
  const paramsArray = toParamsArray(request.params);
  const [raw] = paramsArray;

  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw arxError({
      reason: ArxReasons.RpcInvalidParams,
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

    throw arxError({
      reason: ArxReasons.RpcInvalidParams,
      message,
      data: { params: request.params },
      cause: error,
    });
  }

  if (metadata.namespace !== "eip155") {
    throw arxError({
      reason: ArxReasons.ChainNotCompatible,
      message: "Requested chain is not compatible with wallet_addEthereumChain",
      data: { chainRef: metadata.chainRef },
    });
  }

  const existing = controllers.chainRegistry.getChain(metadata.chainRef);
  if (existing && existing.namespace !== "eip155") {
    throw arxError({
      reason: ArxReasons.ChainNotCompatible,
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
    await controllers.approvals.requestApproval(task, requireRequestContext(rpcContext, "wallet_addEthereumChain"));
  } catch (error) {
    if (isDomainError(error) || isRpcError(error)) throw error;
    throw arxError({
      reason: ArxReasons.ApprovalRejected,
      message: "User rejected chain addition",
      data: { origin },
      cause: error,
    });
  }

  return null;
};
const handleWalletGetPermissions: MethodHandler = ({ origin, controllers }) => {
  const grants = controllers.permissions.listGrants(origin);
  const getAccounts = (chainRef: string) =>
    controllers.permissions.getPermittedAccounts(origin, {
      namespace: EIP155_NAMESPACE,
      chainRef: chainRef as ChainRef,
    });

  return buildWalletPermissions({ origin, grants, getAccounts });
};
const parsePermissionRequests = (
  params: JsonRpcParams | undefined,
  defaultChain: ChainRef,
): PermissionRequestDescriptor[] => {
  const [raw] = toParamsArray(params);
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw arxError({
      reason: ArxReasons.RpcInvalidParams,
      message: "wallet_requestPermissions expects a single object parameter",
      data: { params },
    });
  }

  const entries = Object.keys(raw);
  if (entries.length === 0) {
    throw arxError({
      reason: ArxReasons.RpcInvalidParams,
      message: "wallet_requestPermissions requires at least one capability",
      data: { params },
    });
  }

  const requests = new Map<string, PermissionRequestDescriptor>();
  const addCapability = (capability: string) => {
    const scope = CAPABILITY_TO_SCOPE.get(capability);
    if (!scope) {
      throw arxError({
        reason: ArxReasons.RpcInvalidParams,
        message: `wallet_requestPermissions does not support capability "${capability}"`,
        data: { capability },
      });
    }
    const existing = requests.get(capability);
    if (existing) {
      if (!existing.chains.includes(defaultChain)) {
        existing.chains.push(defaultChain);
      }
      return;
    }
    requests.set(capability, {
      scope,
      capability,
      chains: [defaultChain],
    });
  };

  for (const capability of entries) {
    addCapability(capability);
  }
  addCapability(PERMISSION_SCOPE_CAPABILITIES[PermissionScopes.Basic]);

  return [...requests.values()];
};

const handleWalletRequestPermissions: MethodHandler = async ({ origin, request, controllers, rpcContext }) => {
  const activeChain = controllers.network.getActiveChain();

  const requested = parsePermissionRequests(request.params, activeChain.chainRef);
  const task: ApprovalTask<RequestPermissionsApprovalPayload> = {
    id: createTaskId("wallet_requestPermissions"),
    type: ApprovalTypes.RequestPermissions,
    origin,
    namespace: activeChain.namespace,
    chainRef: activeChain.chainRef,
    createdAt: Date.now(),
    payload: { requested },
  };

  try {
    const result = (await controllers.approvals.requestApproval(
      task,
      requireRequestContext(rpcContext, "wallet_requestPermissions"),
    )) as PermissionApprovalResult;
    const grants = result?.granted ?? [];

    for (const descriptor of grants) {
      const targetChains = descriptor.chains.length ? descriptor.chains : [activeChain.chainRef];
      for (const chainRef of targetChains) {
        if (descriptor.scope === PermissionScopes.Accounts) {
          const all = controllers.accounts.getAccounts({ chainRef });
          const pointer = controllers.accounts.getActivePointer();
          const preferred =
            pointer?.chainRef === chainRef && pointer.address && all.includes(pointer.address) ? pointer.address : null;
          const selected = preferred ?? all[0] ?? null;
          if (!selected) {
            throw arxError({
              reason: ArxReasons.PermissionDenied,
              message: "No selectable account available for permission request",
              data: { origin, chainRef, capability: descriptor.capability },
            });
          }

          await controllers.permissions.setPermittedAccounts(origin, {
            namespace: activeChain.namespace,
            chainRef,
            accounts: [selected],
          });
          continue;
        }

        await controllers.permissions.grant(origin, descriptor.scope, {
          namespace: activeChain.namespace,
          chainRef,
        });
      }
    }
  } catch (error) {
    if (isDomainError(error) || isRpcError(error)) throw error;
    throw arxError({
      reason: ArxReasons.ApprovalRejected,
      message: "User rejected permission request",
      data: { origin },
      cause: error,
    });
  }

  const grants = controllers.permissions.listGrants(origin);
  const getAccounts = (chainRef: string) =>
    controllers.permissions.getPermittedAccounts(origin, {
      namespace: EIP155_NAMESPACE,
      chainRef: chainRef as ChainRef,
    });
  return buildWalletPermissions({ origin, grants, getAccounts });
};

const handlePersonalSign: MethodHandler = async ({ origin, request, controllers, rpcContext }) => {
  const paramsArray = toParamsArray(request.params);

  if (paramsArray.length < 2) {
    throw arxError({
      reason: ArxReasons.RpcInvalidParams,
      message: "personal_sign requires message and account parameters",
      data: { params: request.params },
    });
  }

  const { address, message } = deriveSigningInputs(paramsArray);

  if (!address) {
    throw arxError({
      reason: ArxReasons.RpcInvalidParams,
      message: "personal_sign expects an account address parameter",
      data: { params: request.params },
    });
  }

  if (!message) {
    throw arxError({
      reason: ArxReasons.RpcInvalidParams,
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
      chainRef: activeChain.chainRef,
      from: address,
      message,
    },
  };

  try {
    const signature = await controllers.approvals.requestApproval(
      task,
      requireRequestContext(rpcContext, "personal_sign"),
    );

    // Grant Sign permission after successful signature
    await controllers.permissions.grant(origin, PermissionScopes.Sign, {
      namespace: "eip155",
      chainRef: activeChain.chainRef,
    });

    return signature;
  } catch (error) {
    if (isDomainError(error) || isRpcError(error)) throw error;
    throw arxError({
      reason: ArxReasons.ApprovalRejected,
      message: "User rejected message signing",
      data: { origin },
      cause: error,
    });
  }
};

const handleEthSignTypedDataV4: MethodHandler = async ({ origin, request, controllers, rpcContext }) => {
  const paramsArray = toParamsArray(request.params);

  if (paramsArray.length < 2) {
    throw arxError({
      reason: ArxReasons.RpcInvalidParams,
      message: "eth_signTypedData_v4 requires address and typed data parameters",
      data: { params: request.params },
    });
  }

  const { address, typedData } = parseTypedDataParams(paramsArray);
  const activeChain = controllers.network.getActiveChain();

  const task = {
    id: createTaskId("eth_signTypedData_v4"),
    type: ApprovalTypes.SignTypedData,
    origin,
    namespace: "eip155",
    chainRef: activeChain.chainRef,
    createdAt: Date.now(),
    payload: {
      chainRef: activeChain.chainRef,
      from: address,
      typedData,
    },
  };

  try {
    const signature = await controllers.approvals.requestApproval(
      task,
      requireRequestContext(rpcContext, "eth_signTypedData_v4"),
    );

    // Grant Sign permission after successful signature
    await controllers.permissions.grant(origin, PermissionScopes.Sign, {
      namespace: "eip155",
      chainRef: activeChain.chainRef,
    });

    return signature;
  } catch (error) {
    if (isDomainError(error) || isRpcError(error)) throw error;
    throw arxError({
      reason: ArxReasons.ApprovalRejected,
      message: "User rejected typed data signing",
      data: { origin },
      cause: error,
    });
  }
};

const handleEthSendTransaction: MethodHandler = async ({ origin, request, controllers, rpcContext }) => {
  const paramsArray = toParamsArray(request.params);

  if (paramsArray.length === 0) {
    throw arxError({
      reason: ArxReasons.RpcInvalidParams,
      message: "eth_sendTransaction requires at least one transaction parameter",
      data: { params: request.params },
    });
  }

  const activeChain = controllers.network.getActiveChain();
  let chainRef = activeChain.chainRef;

  const ctxChainRef = rpcContext?.chainRef ?? null;
  if (ctxChainRef) {
    try {
      const parsed = parseChainRef(ctxChainRef);
      if (parsed.namespace !== "eip155") {
        throw arxError({
          reason: ArxReasons.ChainNotCompatible,
          message: "Requested chain is not compatible with eth_sendTransaction",
          data: { chainRef: ctxChainRef },
        });
      }
      chainRef = `${parsed.namespace}:${parsed.reference}`;
    } catch (error) {
      if (isDomainError(error) || isRpcError(error)) throw error;
      throw arxError({
        reason: ArxReasons.RpcInvalidParams,
        message: "eth_sendTransaction received an invalid chainRef identifier",
        data: { chainRef: ctxChainRef },
        cause: error,
      });
    }
  }

  const txRequest = buildEip155TransactionRequest(paramsArray, chainRef);

  try {
    const meta = await controllers.transactions.requestTransactionApproval(
      origin,
      txRequest,
      requireRequestContext(rpcContext, "eth_sendTransaction"),
    );
    const broadcastMeta = await waitForTransactionBroadcast(controllers.transactions, meta.id);

    if (typeof broadcastMeta.hash !== "string") {
      throw new TransactionResolutionError(broadcastMeta);
    }

    await controllers.permissions.grant(origin, PermissionScopes.Transaction, {
      namespace: broadcastMeta.namespace,
      chainRef: broadcastMeta.chainRef,
    });

    return broadcastMeta.hash;
  } catch (error) {
    if (isDomainError(error) || isRpcError(error)) {
      throw error;
    }

    if (error instanceof TransactionResolutionError) {
      const { meta: failedMeta } = error;

      if (failedMeta.userRejected) {
        throw arxError({
          reason: ArxReasons.ApprovalRejected,
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

      throw arxError({
        reason: ArxReasons.RpcInternal,
        message: failure?.message ?? "Transaction failed to broadcast",
        data: { origin, id: failedMeta.id, error: failure ?? undefined },
      });
    }

    throw arxError({
      reason: ArxReasons.RpcInternal,
      message: error instanceof Error ? error.message : "Transaction submission failed",
      data: { origin },
      cause: error,
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
  wallet_getPermissions: {
    scope: PermissionScopes.Basic,
    locked: lockedAllow(),
    handler: handleWalletGetPermissions,
    isBootstrap: true,
  },
  wallet_requestPermissions: {
    scope: PermissionScopes.Basic,
    approvalRequired: true,
    handler: handleWalletRequestPermissions,
    isBootstrap: true,
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
});
