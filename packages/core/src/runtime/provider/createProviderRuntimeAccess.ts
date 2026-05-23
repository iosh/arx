import { ArxReasons, arxError } from "@arx/errors";
import type { ChainRef } from "../../chains/ids.js";
import type { UnlockLockedPayload, UnlockUnlockedPayload } from "../../controllers/unlock/types.js";
import type {
  JsonRpcError,
  JsonRpcParams,
  JsonRpcRequest,
  JsonRpcResponse,
  RpcInvocationHint,
} from "../../rpc/index.js";
import { RpcExecutionContextKinds } from "../../rpc/index.js";
import type { StateChangeSubscription } from "../../services/store/_shared/signal.js";
import type { ProviderRequestHandle, ProviderRequests } from "./providerRequests.js";
import type {
  ProviderRuntimeAccess,
  ProviderRuntimeAccountsQuery,
  ProviderRuntimeConnectionQuery,
  ProviderRuntimeConnectionState,
  ProviderRuntimeErrorContext,
  ProviderRuntimeExecutionContext,
  ProviderRuntimeRequestContext,
  ProviderRuntimeRequestScope,
  ProviderRuntimeRpcContext,
  ProviderRuntimeRpcRequest,
  ProviderRuntimeSnapshot,
} from "./types.js";

type ProviderRuntimeRequestEnvelope = JsonRpcRequest<JsonRpcParams> & {
  origin: string;
  arx: RpcInvocationHint;
  arxExecution: ProviderRuntimeExecutionContext;
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
  resolveMethodNamespace: (method: string, hint?: RpcInvocationHint) => string | null;
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
  resolvedExecutionContext: ProviderRuntimeExecutionContext;
  engineRequest: ProviderRuntimeRequestEnvelope;
};

const buildRpcInvocationHint = (context: ProviderRuntimeRpcContext): RpcInvocationHint => {
  if (context.chainRef !== undefined) {
    return { namespace: context.providerNamespace, chainRef: context.chainRef };
  }

  return { namespace: context.providerNamespace };
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

  const encodeRpcError = (error: unknown, { origin, method, context }: ProviderRuntimeErrorContext): JsonRpcError => {
    const invocationHint = buildRpcInvocationHint(context);

    return encodeDappError(error, {
      namespace: resolveMethodNamespace(method, invocationHint) ?? null,
      chainRef: context.chainRef ?? null,
      origin,
      method,
    });
  };

  const executeRpcRequest = async ({
    origin,
    context,
    execution,
    ...request
  }: ProviderRuntimeRpcRequest): Promise<JsonRpcResponse> => {
    let providerRequestHandle: ProviderRequestHandle | null = null;
    let errorContext: ProviderRuntimeRpcContext = context;

    const buildErrorResponse = (error: unknown, nextErrorContext: ProviderRuntimeRpcContext): JsonRpcResponse => ({
      id: request.id,
      jsonrpc: request.jsonrpc,
      error: encodeRpcError(error, {
        origin,
        method: request.method,
        context: nextErrorContext,
      }),
    });

    const validateAndBeginRequest = (): BegunProviderRuntimeRequest => {
      const requestScope = execution.requestScope;

      const providerNamespace = resolveMethodNamespace(request.method, buildRpcInvocationHint(context));
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
        providerNamespace,
        ...(context.chainRef !== undefined ? { chainRef: context.chainRef } : {}),
      };
      const resolvedExecutionContext: ProviderRuntimeExecutionContext = {
        kind: RpcExecutionContextKinds.Provider,
        requestContext,
        providerRequestHandle,
      };
      const invocationHint = buildRpcInvocationHint(resolvedContext);

      return {
        providerRequestHandle,
        resolvedContext,
        resolvedExecutionContext,
        engineRequest: {
          id: request.id,
          jsonrpc: request.jsonrpc,
          method: request.method,
          origin,
          ...(request.params !== undefined ? { params: request.params } : {}),
          arx: invocationHint,
          arxExecution: resolvedExecutionContext,
        },
      };
    };

    const runEngineRequest = async (begun: BegunProviderRuntimeRequest): Promise<JsonRpcResponse> => {
      // Scope-cancel error mapping lives at the handler/controller boundary.
      // Long-running handlers must honor the request signal before reporting success.
      return await new Promise<JsonRpcResponse>((resolve) => {
        handleRpcRequest(begun.engineRequest, (error, response) => {
          if (error) {
            begun.providerRequestHandle.reject();
            resolve(buildErrorResponse(error, begun.resolvedContext));
            return;
          }

          if (!response) {
            const missingResponseError = new Error("Missing JSON-RPC response");
            begun.providerRequestHandle.reject();
            resolve(buildErrorResponse(missingResponseError, begun.resolvedContext));
            return;
          }

          if ("error" in response) {
            begun.providerRequestHandle.reject();
            resolve(response as JsonRpcResponse);
            return;
          }

          begun.providerRequestHandle.fulfill();
          resolve(response as JsonRpcResponse);
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
    return await providerRequests.cancelScope(input, "caller_disconnected");
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
