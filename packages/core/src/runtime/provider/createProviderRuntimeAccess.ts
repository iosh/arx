import { ArxReasons, arxError } from "@arx/errors";
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
import type { ProviderRequestHandle, ProviderRequests } from "./providerRequests.js";
import type {
  ProviderRuntimeAccess,
  ProviderRuntimeAccountsQuery,
  ProviderRuntimeConnectionQuery,
  ProviderRuntimeConnectionState,
  ProviderRuntimeErrorContext,
  ProviderRuntimeRequestContext,
  ProviderRuntimeRequestScope,
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
  providerRequests: ProviderRequests;
  subscribeSessionUnlocked: (listener: (payload: UnlockUnlockedPayload) => void) => () => void;
  subscribeSessionLocked: (listener: (payload: UnlockLockedPayload) => void) => () => void;
  subscribeNetworkStateChanged: StateChangeSubscription;
  subscribeNetworkSelectionChanged: StateChangeSubscription;
  subscribeAccountsStateChanged: StateChangeSubscription;
  subscribePermissionsStateChanged: StateChangeSubscription;
};

type BegunProviderRuntimeRequest = {
  providerRequestHandle: ProviderRequestHandle;
  resolvedContext: ProviderRuntimeRpcContext;
  engineRequest: ProviderRuntimeRequestEnvelope;
};

const toRpcInvocationContext = (context?: ProviderRuntimeRpcContext): RpcInvocationContext | undefined => {
  if (!context) {
    return undefined;
  }

  return {
    ...(context.chainRef !== undefined ? { chainRef: context.chainRef } : {}),
    ...(context.providerNamespace !== undefined ? { providerNamespace: context.providerNamespace } : {}),
    ...(context.requestContext !== undefined ? { requestContext: context.requestContext } : {}),
    ...(context.providerRequestHandle !== undefined ? { providerRequestHandle: context.providerRequestHandle } : {}),
  };
};

const rejectProviderRequestHandle = (handle: ProviderRequestHandle | null) => {
  return handle ? handle.reject() : false;
};

const getProviderRequestTerminalError = (handle: ProviderRequestHandle | null) => {
  return handle?.getTerminalError() ?? null;
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
  providerRequests,
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
    let providerRequestHandle: ProviderRequestHandle | null = null;
    let errorContext: ProviderRuntimeRpcContext | undefined = context;

    const buildErrorResponse = (
      error: unknown,
      nextErrorContext: ProviderRuntimeRpcContext | undefined,
    ): JsonRpcResponse => ({
      id: request.id,
      jsonrpc: request.jsonrpc,
      error: encodeRpcError(error, {
        origin,
        method: request.method,
        rpcContext: nextErrorContext,
      }),
    });

    const validateAndBeginRequest = (): BegunProviderRuntimeRequest => {
      const requestScope = context?.requestScope;
      if (!requestScope) {
        throw arxError({
          reason: ArxReasons.RpcInvalidRequest,
          message: "Missing provider request scope.",
          data: { origin },
        });
      }

      const providerNamespace = resolveMethodNamespace(request.method, toRpcInvocationContext(context));
      if (!providerNamespace) {
        throw arxError({
          reason: ArxReasons.RpcInvalidRequest,
          message: `Missing namespace context for "${request.method}"`,
          data: { method: request.method, origin },
        });
      }

      providerRequestHandle = providerRequests.beginRequest({
        scope: requestScope,
        rpcId: request.id,
        providerNamespace,
        method: request.method,
      });

      const requestContext: ProviderRuntimeRequestContext = {
        transport: requestScope.transport,
        origin: requestScope.origin,
        portId: requestScope.portId,
        sessionId: requestScope.sessionId,
        requestId: providerRequestHandle.id,
      };

      const resolvedContext: ProviderRuntimeRpcContext = {
        ...(context?.chainRef !== undefined ? { chainRef: context.chainRef } : {}),
        providerNamespace,
        requestContext,
        providerRequestHandle,
      };
      const rpcContext = toRpcInvocationContext(resolvedContext);

      return {
        providerRequestHandle,
        resolvedContext,
        engineRequest: {
          id: request.id,
          jsonrpc: request.jsonrpc,
          method: request.method,
          origin,
          ...(request.params !== undefined ? { params: request.params } : {}),
          ...(rpcContext ? { arx: rpcContext } : {}),
        },
      };
    };

    const runEngineRequest = async (begun: BegunProviderRuntimeRequest): Promise<JsonRpcResponse> => {
      const buildTerminalErrorResponse = (fallback: unknown) => {
        return buildErrorResponse(begun.providerRequestHandle.getTerminalError() ?? fallback, begun.resolvedContext);
      };

      return await new Promise<JsonRpcResponse>((resolve) => {
        handleRpcRequest(begun.engineRequest, (error, response) => {
          if (error) {
            const didReject = begun.providerRequestHandle.reject();
            resolve(didReject ? buildErrorResponse(error, begun.resolvedContext) : buildTerminalErrorResponse(error));
            return;
          }

          if (!response) {
            const missingResponseError = new Error("Missing JSON-RPC response");
            const didReject = begun.providerRequestHandle.reject();
            resolve(
              didReject
                ? buildErrorResponse(missingResponseError, begun.resolvedContext)
                : buildTerminalErrorResponse(missingResponseError),
            );
            return;
          }

          if ("error" in response) {
            const didReject = begun.providerRequestHandle.reject();
            resolve(didReject ? (response as JsonRpcResponse) : buildTerminalErrorResponse(response.error));
            return;
          }

          const didFulfill = begun.providerRequestHandle.fulfill();
          resolve(didFulfill ? (response as JsonRpcResponse) : buildTerminalErrorResponse(response));
        });
      });
    };

    try {
      const begun = validateAndBeginRequest();
      errorContext = begun.resolvedContext;
      return await runEngineRequest(begun);
    } catch (error) {
      const didReject = rejectProviderRequestHandle(providerRequestHandle);
      if (didReject) {
        return buildErrorResponse(error, errorContext);
      }
      return buildErrorResponse(getProviderRequestTerminalError(providerRequestHandle) ?? error, errorContext);
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

  const cancelRequestScope = async (input: ProviderRuntimeRequestScope) => {
    return await providerRequests.cancelScope(input, "session_lost");
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
    cancelRequestScope,
  };
};
