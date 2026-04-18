import type { ChainRef } from "../../chains/ids.js";
import type { UnlockLockedPayload, UnlockUnlockedPayload } from "../../controllers/unlock/types.js";
import type {
  JsonRpcError,
  JsonRpcParams,
  JsonRpcRequest,
  JsonRpcResponse,
  RpcInvocationContext,
} from "../../rpc/index.js";
import type { StateChangeSubscription } from "../../services/store/_shared/signal.js";
import type {
  ProviderRuntimeAccess,
  ProviderRuntimeAccountsQuery,
  ProviderRuntimeConnectionQuery,
  ProviderRuntimeConnectionState,
  ProviderRuntimeErrorContext,
  ProviderRuntimeRpcContext,
  ProviderRuntimeRpcRequest,
  ProviderRuntimeSnapshot,
} from "./types.js";

type ProviderRuntimeRequestEnvelope = JsonRpcRequest<JsonRpcParams> & {
  origin: string;
  arx?: RpcInvocationContext;
};

const UNKNOWN_ORIGIN = "unknown://";

type ProviderRuntimeChainView = {
  chainId: string;
  chainRef: ChainRef;
};

type ProviderRuntimeAccessDeps = {
  getSessionStatus: () => { isUnlocked: boolean };
  getActiveChainViewForNamespace: (namespace: string) => ProviderRuntimeChainView;
  buildProviderMeta: (namespace: string) => {
    activeChainByNamespace: Record<string, ChainRef>;
    supportedChains: ChainRef[];
  };
  getActiveChainByNamespace: () => Record<string, ChainRef>;
  listPermittedAccountsView: (origin: string, options: { chainRef: ChainRef }) => Array<{ canonicalAddress: string }>;
  formatAddress: (input: { chainRef: ChainRef; canonical: string }) => string;
  resolveMethodNamespace: (method: string, context?: RpcInvocationContext) => string | null;
  handleRpcRequest: (
    request: ProviderRuntimeRequestEnvelope,
    callback: (error: unknown, response: JsonRpcResponse | null | undefined) => void,
  ) => void;
  encodeDappError: (
    error: unknown,
    context: {
      namespace: string | null;
      chainRef: ChainRef | null;
      origin: string;
      method: string;
    },
  ) => JsonRpcError;
  cancelSessionApprovals: (input: { origin: string; portId: string; sessionId: string }) => Promise<number>;
  subscribeSessionUnlocked: (listener: (payload: UnlockUnlockedPayload) => void) => () => void;
  subscribeSessionLocked: (listener: (payload: UnlockLockedPayload) => void) => () => void;
  subscribeNetworkStateChanged: StateChangeSubscription;
  subscribeNetworkSelectionChanged: StateChangeSubscription;
  subscribeAccountsStateChanged: StateChangeSubscription;
  subscribePermissionsStateChanged: StateChangeSubscription;
};

const toRpcInvocationContext = (context?: ProviderRuntimeRpcContext): RpcInvocationContext | undefined => {
  if (!context) {
    return undefined;
  }

  return {
    ...(context.chainRef !== undefined ? { chainRef: context.chainRef } : {}),
    ...(context.providerNamespace !== undefined ? { providerNamespace: context.providerNamespace } : {}),
    ...(context.requestContext !== undefined ? { requestContext: context.requestContext } : {}),
  };
};

export const createProviderRuntimeAccess = ({
  getSessionStatus,
  getActiveChainViewForNamespace,
  buildProviderMeta,
  getActiveChainByNamespace,
  listPermittedAccountsView,
  formatAddress,
  resolveMethodNamespace,
  handleRpcRequest,
  encodeDappError,
  cancelSessionApprovals,
  subscribeSessionUnlocked,
  subscribeSessionLocked,
  subscribeNetworkStateChanged,
  subscribeNetworkSelectionChanged,
  subscribeAccountsStateChanged,
  subscribePermissionsStateChanged,
}: ProviderRuntimeAccessDeps): ProviderRuntimeAccess => {
  const buildSnapshotFromState = (namespace: string, isUnlocked: boolean): ProviderRuntimeSnapshot => {
    const providerMeta = buildProviderMeta(namespace);
    const providerChain = getActiveChainViewForNamespace(namespace);
    const supportedChains = providerMeta.supportedChains.filter((chainRef) => chainRef.startsWith(`${namespace}:`));

    return {
      namespace,
      chain: {
        chainId: providerChain.chainId,
        chainRef: providerChain.chainRef,
      },
      isUnlocked,
      meta: {
        activeChainByNamespace: {
          [namespace]: providerMeta.activeChainByNamespace[namespace] ?? providerChain.chainRef,
        },
        supportedChains,
      },
    };
  };

  const buildSnapshot = (namespace: string): ProviderRuntimeSnapshot => {
    return buildSnapshotFromState(namespace, getSessionStatus().isUnlocked);
  };

  const listPermittedAccountsForState = ({
    origin,
    chainRef,
    isUnlocked,
  }: ProviderRuntimeAccountsQuery & { isUnlocked: boolean }): string[] => {
    if (!isUnlocked) {
      return [];
    }

    if (origin === UNKNOWN_ORIGIN) {
      return [];
    }

    return listPermittedAccountsView(origin, { chainRef }).map((account) =>
      formatAddress({
        chainRef,
        canonical: account.canonicalAddress,
      }),
    );
  };

  const encodeRpcError = (
    error: unknown,
    { origin, method, rpcContext }: ProviderRuntimeErrorContext,
  ): JsonRpcError => {
    const resolvedRpcContext = toRpcInvocationContext(rpcContext);

    return encodeDappError(error, {
      namespace: resolveMethodNamespace(method, resolvedRpcContext) ?? null,
      chainRef: rpcContext?.chainRef ?? null,
      origin,
      method,
    });
  };

  const executeRpcRequest = async ({
    origin,
    context,
    ...request
  }: ProviderRuntimeRpcRequest): Promise<JsonRpcResponse> => {
    const rpcContext = toRpcInvocationContext(context);
    const engineRequest: ProviderRuntimeRequestEnvelope = {
      id: request.id,
      jsonrpc: request.jsonrpc,
      method: request.method,
      origin,
      ...(request.params !== undefined ? { params: request.params } : {}),
      ...(rpcContext ? { arx: rpcContext } : {}),
    };

    const buildErrorResponse = (error: unknown): JsonRpcResponse => ({
      id: request.id,
      jsonrpc: request.jsonrpc,
      error: encodeRpcError(error, {
        origin,
        method: request.method,
        rpcContext: context,
      }),
    });

    try {
      return await new Promise<JsonRpcResponse>((resolve) => {
        handleRpcRequest(engineRequest, (error, response) => {
          if (error) {
            resolve(buildErrorResponse(error));
            return;
          }

          if (!response) {
            resolve(buildErrorResponse(new Error("Missing JSON-RPC response")));
            return;
          }

          resolve(response as JsonRpcResponse);
        });
      });
    } catch (error) {
      return buildErrorResponse(error);
    }
  };

  const listPermittedAccounts = async ({ origin, chainRef }: ProviderRuntimeAccountsQuery): Promise<string[]> => {
    return listPermittedAccountsForState({
      origin,
      chainRef,
      isUnlocked: getSessionStatus().isUnlocked,
    });
  };

  const buildConnectionState = async ({
    namespace,
    origin,
  }: ProviderRuntimeConnectionQuery): Promise<ProviderRuntimeConnectionState> => {
    const isUnlocked = getSessionStatus().isUnlocked;
    const snapshot = buildSnapshotFromState(namespace, isUnlocked);

    return {
      snapshot,
      accounts: listPermittedAccountsForState({
        origin,
        chainRef: snapshot.chain.chainRef,
        isUnlocked,
      }),
    };
  };

  const cancelProviderSessionApprovals = async (input: { origin: string; portId: string; sessionId: string }) => {
    return await cancelSessionApprovals(input);
  };

  return {
    buildSnapshot,
    buildConnectionState,
    getActiveChainByNamespace,
    subscribeSessionUnlocked,
    subscribeSessionLocked,
    subscribeNetworkStateChanged,
    subscribeNetworkSelectionChanged,
    subscribeAccountsStateChanged,
    subscribePermissionsStateChanged,
    executeRpcRequest,
    encodeRpcError,
    listPermittedAccounts,
    cancelSessionApprovals: cancelProviderSessionApprovals,
  };
};
