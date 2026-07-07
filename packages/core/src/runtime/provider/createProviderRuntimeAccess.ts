import type { ApprovalQueueService } from "../../approvals/queue/types.js";
import type { ChainRef } from "../../chains/ids.js";
import { isArxBaseError } from "../../error.js";
import { eventTopic, type Messenger } from "../../messenger/index.js";
import { PermissionNotConnectedError } from "../../permissions/errors.js";
import {
  isJsonRpcErrorLike,
  RpcInternalError,
  RpcUnsupportedMethodError,
  sanitizeJsonRpcErrorObject,
} from "../../rpc/errors.js";
import { AuthorizationRequirements } from "../../rpc/handlers/types.js";
import type { Json, JsonRpcParams, ResolvedRpcInvocationDetails, RpcInvocationHint } from "../../rpc/index.js";
import { RpcExecutionContextKinds } from "../../rpc/index.js";
import { SessionLockedError } from "../../runtime/session/errors.js";
import type { UnlockLockedPayload, UnlockUnlockedPayload } from "../../runtime/session/unlock/types.js";
import type { ProviderChainSelectionChangedHandler } from "../../chains/selection/provider/types.js";
import { InvalidProviderConnectionScopeError } from "./errors.js";
import type { ProviderRequestHandle, ProviderRequests } from "./providerRequests.js";
import type {
  ProviderConnectionScope,
  ProviderConnectionStateChange,
  ProviderConnectionStateChangedHandler,
  ProviderRequestInput,
  ProviderRequestScope,
  ProviderRuntimeAccess,
  ProviderRuntimeAccountsQuery,
  ProviderRuntimeConnectionQuery,
  ProviderRuntimeConnectionState,
  ProviderRuntimeExecutionContext,
  ProviderRuntimeRequestContext,
  ProviderRuntimeRequestScope,
  ProviderRuntimeRpcError,
  ProviderRuntimeRpcResponse,
  ProviderRuntimeSnapshot,
  ResolvedProviderRequestContext,
} from "./types.js";

const UNKNOWN_ORIGIN = "unknown://";

type ProviderRuntimeResolvedChain = {
  chain: {
    chainId: string;
    chainRef: ChainRef;
  };
};

type ProviderRuntimeExecuteRequest = (args: {
  origin: string;
  request: {
    method: string;
    params?: JsonRpcParams;
  };
  invocation: ResolvedRpcInvocationDetails;
  executionContext: ProviderRuntimeExecutionContext;
}) => Promise<unknown>;

type ProviderRuntimeAccessDeps = {
  messenger: Messenger;
  getIsInitialized: () => boolean;
  getSessionStatus: () => { isUnlocked: boolean };
  resolveProviderChain: (input: ProviderRuntimeConnectionQuery) => ProviderRuntimeResolvedChain;
  initializeProviderChainSelection: (input: ProviderConnectionScope) => Promise<void>;
  listPermittedAccountsView: (origin: string, options: { chainRef: ChainRef }) => Array<{ canonicalAddress: string }>;
  formatAddress: (input: { chainRef: ChainRef; canonical: string }) => string;
  resolveInvocationDetails: (method: string, hint?: RpcInvocationHint) => ResolvedRpcInvocationDetails;
  executeRequest: ProviderRuntimeExecuteRequest;
  isInternalOrigin: (origin: string) => boolean;
  shouldRequestUnlockAttention?: (ctx: {
    origin: string;
    method: string;
    chainRef: string | null;
    namespace: string | null;
  }) => boolean;
  requestUnlockAttention: (args: {
    origin: string;
    method: string;
    chainRef: string | null;
    namespace: string | null;
  }) => void;
  isAuthorized: (origin: string, options: { namespace: string; chainRef: ChainRef }) => boolean;
  approvals: Pick<ApprovalQueueService, "cancelScope">;
  providerRequests: ProviderRequests;
  subscribeSessionUnlocked: (listener: (payload: UnlockUnlockedPayload) => void) => () => void;
  subscribeSessionLocked: (listener: (payload: UnlockLockedPayload) => void) => () => void;
  subscribeChainRpcStateChanged: (listener: () => void) => () => void;
  subscribeProviderChainSelectionChanged: (listener: ProviderChainSelectionChangedHandler) => () => void;
  subscribeAccountsStateChanged: (listener: () => void) => () => void;
  subscribePermissionsStateChanged: (listener: () => void) => () => void;
  logger?: (message: string, error?: unknown) => void;
};

type BegunProviderRuntimeRequest = {
  kind: "begun";
  providerRequestHandle: ProviderRequestHandle;
  resolvedContext: ResolvedProviderRequestContext;
  resolvedExecutionContext: ProviderRuntimeExecutionContext;
  invocation: ResolvedRpcInvocationDetails;
};

type PreparedProviderRuntimeRequest =
  | BegunProviderRuntimeRequest
  | {
      kind: "response";
      resolvedContext: ResolvedProviderRequestContext;
      result: Json;
    };

type ProviderAccessPolicyResult = { kind: "continue" } | { kind: "response"; result: Json };

const rejectProviderRequestHandle = (handle: ProviderRequestHandle | null) => {
  return handle ? handle.reject() : false;
};

const getProviderRequestTerminalError = (handle: ProviderRequestHandle | null) => {
  return handle?.getTerminalError() ?? null;
};

const encodeProviderRuntimeError = (error: unknown): ProviderRuntimeRpcError => {
  if (isJsonRpcErrorLike(error)) {
    const sanitized = sanitizeJsonRpcErrorObject(error);
    return { kind: "JsonRpcError", ...sanitized };
  }

  if (isArxBaseError(error)) {
    return { kind: "ArxError", code: error.code };
  }

  return { kind: "JsonRpcError", code: -32603, message: "Internal error" };
};

const createRuntimeNotInitializedError = () =>
  new RpcInternalError({
    message: "Background runtime is not initialized (call lifecycle.initialize() first).",
  });

const PROVIDER_CONNECTION_STATE_CHANGED = eventTopic<ProviderConnectionStateChange>("provider:connectionStateChanged");

const parseProviderConnectionScope = ({ origin, namespace }: ProviderConnectionScope): ProviderConnectionScope => {
  if (origin.length === 0 || origin.trim() !== origin) {
    throw new InvalidProviderConnectionScopeError({
      field: "origin",
      message: "Provider connection scope origin is required.",
    });
  }

  if (namespace.length === 0 || namespace.trim() !== namespace) {
    throw new InvalidProviderConnectionScopeError({
      field: "namespace",
      message: "Provider connection scope namespace is required.",
    });
  }

  return {
    origin,
    namespace,
  };
};

const areAccountListsEqual = (left: readonly string[], right: readonly string[]) => {
  return left.length === right.length && left.every((account, index) => account === right[index]);
};

const deriveProviderConnectionStateChange = (args: {
  scope: ProviderConnectionScope;
  previous: ProviderRuntimeConnectionState;
  next: ProviderRuntimeConnectionState;
}): ProviderConnectionStateChange | null => {
  const { scope, previous, next } = args;
  const chainChanged =
    previous.snapshot.chain.chainId !== next.snapshot.chain.chainId ||
    previous.snapshot.chain.chainRef !== next.snapshot.chain.chainRef;
  const accountsChanged = !areAccountListsEqual(previous.accounts, next.accounts);

  if (!chainChanged && !accountsChanged) {
    return null;
  }

  return {
    scope,
    previous,
    next,
    changed: {
      chain: chainChanged,
      accounts: accountsChanged,
    },
  };
};

export const createProviderRuntimeAccess = ({
  messenger,
  getIsInitialized,
  getSessionStatus,
  resolveProviderChain,
  initializeProviderChainSelection,
  listPermittedAccountsView,
  formatAddress,
  resolveInvocationDetails,
  executeRequest: executeCoreRequest,
  isInternalOrigin,
  shouldRequestUnlockAttention,
  requestUnlockAttention,
  isAuthorized,
  approvals,
  providerRequests,
  subscribeSessionUnlocked,
  subscribeSessionLocked,
  subscribeChainRpcStateChanged,
  subscribeProviderChainSelectionChanged,
  subscribeAccountsStateChanged,
  subscribePermissionsStateChanged,
  logger,
}: ProviderRuntimeAccessDeps): ProviderRuntimeAccess => {
  type ActiveConnectionScopeState = {
    scope: ProviderConnectionScope;
    state: ProviderRuntimeConnectionState;
  };

  const activeScopesByOrigin = new Map<string, Map<string, ActiveConnectionScopeState>>();
  let connectionStateReconcileQueue: Promise<void> = Promise.resolve();

  const buildSnapshotForScope = (input: ProviderConnectionScope, isUnlocked: boolean): ProviderRuntimeSnapshot => {
    const { namespace } = input;
    const resolvedProviderChain = resolveProviderChain(input);
    const { chain } = resolvedProviderChain;

    return {
      namespace,
      chain: {
        chainId: chain.chainId,
        chainRef: chain.chainRef,
      },
      isUnlocked,
    };
  };

  const buildSnapshot = (input: ProviderRuntimeConnectionQuery): ProviderRuntimeSnapshot => {
    return buildSnapshotForScope(parseProviderConnectionScope(input), getSessionStatus().isUnlocked);
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

  const encodeRuntimeRpcError = (error: unknown): ProviderRuntimeRpcError => {
    return encodeProviderRuntimeError(error);
  };

  const copyConnectionState = (state: ProviderRuntimeConnectionState): ProviderRuntimeConnectionState => ({
    snapshot: {
      namespace: state.snapshot.namespace,
      chain: {
        chainId: state.snapshot.chain.chainId,
        chainRef: state.snapshot.chain.chainRef,
      },
      isUnlocked: state.snapshot.isUnlocked,
    },
    accounts: [...state.accounts],
  });

  const getActiveScopeState = (scope: ProviderConnectionScope): ActiveConnectionScopeState | null => {
    return activeScopesByOrigin.get(scope.origin)?.get(scope.namespace) ?? null;
  };

  const setActiveScopeState = (scope: ProviderConnectionScope, state: ProviderRuntimeConnectionState) => {
    let namespaceStates = activeScopesByOrigin.get(scope.origin);
    if (!namespaceStates) {
      namespaceStates = new Map();
      activeScopesByOrigin.set(scope.origin, namespaceStates);
    }

    namespaceStates.set(scope.namespace, {
      scope,
      state: copyConnectionState(state),
    });
  };

  const deleteActiveScopeState = (scope: ProviderConnectionScope) => {
    const namespaceStates = activeScopesByOrigin.get(scope.origin);
    if (!namespaceStates) {
      return;
    }

    namespaceStates.delete(scope.namespace);
    if (namespaceStates.size === 0) {
      activeScopesByOrigin.delete(scope.origin);
    }
  };

  const listActiveConnectionScopes = (): ProviderConnectionScope[] => {
    const scopes: ProviderConnectionScope[] = [];

    for (const namespaceStates of activeScopesByOrigin.values()) {
      for (const { scope } of namespaceStates.values()) {
        scopes.push(scope);
      }
    }

    return scopes.sort(
      (left, right) => left.origin.localeCompare(right.origin) || left.namespace.localeCompare(right.namespace),
    );
  };

  const selectActiveConnectionScopes = (
    predicate: (scope: ProviderConnectionScope) => boolean,
  ): ProviderConnectionScope[] => {
    return listActiveConnectionScopes().filter(predicate);
  };

  const requestUnlockAttentionIfNeeded = (args: {
    origin: string;
    method: string;
    chainRef: string | null;
    namespace: string | null;
  }) => {
    const shouldRequest = shouldRequestUnlockAttention ?? (() => true);
    if (!shouldRequest(args)) {
      return;
    }

    try {
      requestUnlockAttention(args);
    } catch {
      // best-effort
    }
  };

  const applyAccessPolicy = (args: {
    origin: string;
    method: string;
    invocation: ResolvedRpcInvocationDetails;
  }): ProviderAccessPolicyResult => {
    if (!getIsInitialized()) {
      throw createRuntimeNotInitializedError();
    }

    const { origin, method, invocation } = args;
    if (isInternalOrigin(origin)) {
      return { kind: "continue" };
    }

    const unlocked = getSessionStatus().isUnlocked;
    const definition = invocation.definition;
    const passthrough = invocation.passthrough;
    const requestUnlockAttention = () => {
      requestUnlockAttentionIfNeeded({
        origin,
        method,
        chainRef: invocation.chainRef,
        namespace: invocation.namespace,
      });
    };

    if (!definition) {
      if (passthrough.isPassthrough) {
        if (unlocked || passthrough.allowWhenLocked) {
          return { kind: "continue" };
        }
        requestUnlockAttention();
        throw new SessionLockedError();
      }

      throw new RpcUnsupportedMethodError({
        message: `Method "${method}" is not supported`,
      });
    }

    if (!unlocked && definition.locked) {
      switch (definition.locked.type) {
        case "response":
          return { kind: "response", result: definition.locked.response };
        case "allow":
          break;
        case "queue":
          requestUnlockAttention();
          break;
        case "deny":
          requestUnlockAttention();
          throw new SessionLockedError();
      }
    }

    switch (definition.authorizationRequirement) {
      case AuthorizationRequirements.None:
        return { kind: "continue" };
      case AuthorizationRequirements.Required: {
        const authorized =
          origin !== UNKNOWN_ORIGIN &&
          invocation.chainRef.length > 0 &&
          isAuthorized(origin, {
            namespace: invocation.namespace,
            chainRef: invocation.chainRef,
          });

        if (!authorized) {
          throw new PermissionNotConnectedError();
        }

        return { kind: "continue" };
      }
      default:
        throw new RpcInternalError({ message: "Unknown authorization requirement." });
    }
  };

  const resolveProviderRequestContext = async (args: {
    scope: ProviderRequestScope;
    method: string;
    namespace: string;
  }): Promise<ResolvedProviderRequestContext> => {
    const parsedScope = parseProviderConnectionScope({
      origin: args.scope.origin,
      namespace: args.namespace,
    });

    if (isInternalOrigin(parsedScope.origin)) {
      const invocation = resolveInvocationDetails(args.method, {
        namespace: parsedScope.namespace,
      });

      return {
        ...args.scope,
        namespace: invocation.namespace,
        chainRef: invocation.chainRef,
      };
    }

    const resolvedProviderChain = resolveProviderChain(parsedScope);
    return {
      ...args.scope,
      namespace: parsedScope.namespace,
      chainRef: resolvedProviderChain.chain.chainRef,
    };
  };

  const request = async ({ scope, namespace, request }: ProviderRequestInput): Promise<ProviderRuntimeRpcResponse> => {
    const origin = scope.origin;
    let providerRequestHandle: ProviderRequestHandle | null = null;

    const buildErrorResponse = (error: unknown): ProviderRuntimeRpcResponse => ({
      id: request.id,
      jsonrpc: request.jsonrpc,
      error: encodeRuntimeRpcError(error),
    });

    const prepareRequest = async (): Promise<PreparedProviderRuntimeRequest> => {
      const requestScope = scope;
      if (!getIsInitialized()) {
        throw createRuntimeNotInitializedError();
      }
      const resolvedContext = await resolveProviderRequestContext({
        scope: requestScope,
        method: request.method,
        namespace,
      });
      const invocation = resolveInvocationDetails(request.method, {
        namespace: resolvedContext.namespace,
        chainRef: resolvedContext.chainRef,
      });

      const accessPolicy = applyAccessPolicy({ origin, method: request.method, invocation });
      if (accessPolicy.kind === "response") {
        return {
          kind: "response",
          resolvedContext,
          result: accessPolicy.result,
        };
      }

      providerRequestHandle = providerRequests.beginRequest({
        scope: requestScope,
        rpcId: request.id,
        namespace: invocation.namespace,
        method: request.method,
      });

      const requestContext: ProviderRuntimeRequestContext = {
        transport: requestScope.transport,
        origin: requestScope.origin,
        portId: requestScope.portId,
        sessionId: requestScope.sessionId,
        requestId: providerRequestHandle.id,
      };

      const resolvedExecutionContext: ProviderRuntimeExecutionContext = {
        kind: RpcExecutionContextKinds.Provider,
        requestContext,
        providerRequestHandle,
      };

      return {
        kind: "begun",
        providerRequestHandle,
        resolvedContext,
        resolvedExecutionContext,
        invocation,
      };
    };

    const runRequest = async (begun: BegunProviderRuntimeRequest): Promise<ProviderRuntimeRpcResponse> => {
      const result = await executeCoreRequest({
        origin,
        request: {
          method: request.method,
          ...(request.params !== undefined ? { params: request.params } : {}),
        },
        invocation: begun.invocation,
        executionContext: begun.resolvedExecutionContext,
      });

      if (!begun.providerRequestHandle.fulfill()) {
        return buildErrorResponse(
          getProviderRequestTerminalError(begun.providerRequestHandle) ?? new RpcInternalError(),
        );
      }

      return {
        id: request.id,
        jsonrpc: request.jsonrpc,
        result,
      };
    };

    try {
      const prepared = await prepareRequest();
      if (prepared.kind === "response") {
        return {
          id: request.id,
          jsonrpc: request.jsonrpc,
          result: prepared.result,
        };
      }
      return await runRequest(prepared);
    } catch (error) {
      const didReject = rejectProviderRequestHandle(providerRequestHandle);
      if (didReject) {
        return buildErrorResponse(error);
      }
      return buildErrorResponse(getProviderRequestTerminalError(providerRequestHandle) ?? error);
    }
  };

  const listPermittedAccounts = async ({ origin, chainRef }: ProviderRuntimeAccountsQuery): Promise<string[]> => {
    return listPermittedAccountsForState({
      origin,
      chainRef,
      isUnlocked: getSessionStatus().isUnlocked,
    });
  };

  const readConnectionStateForScope = (scope: ProviderConnectionScope): ProviderRuntimeConnectionState => {
    const isUnlocked = getSessionStatus().isUnlocked;
    const snapshot = buildSnapshotForScope(scope, isUnlocked);

    return {
      snapshot,
      accounts: listPermittedAccountsForState({
        origin: scope.origin,
        chainRef: snapshot.chain.chainRef,
        isUnlocked,
      }),
    };
  };

  const buildConnectionState = async ({
    namespace,
    origin,
  }: ProviderRuntimeConnectionQuery): Promise<ProviderRuntimeConnectionState> => {
    return readConnectionStateForScope(parseProviderConnectionScope({ origin, namespace }));
  };

  const reconcileConnectionScope = async (scope: ProviderConnectionScope) => {
    const activeState = getActiveScopeState(scope);
    if (!activeState) {
      return;
    }

    const next = await readConnectionStateForScope(scope);
    setActiveScopeState(scope, next);
    const change = deriveProviderConnectionStateChange({
      scope,
      previous: activeState.state,
      next,
    });

    if (change) {
      messenger.publish(PROVIDER_CONNECTION_STATE_CHANGED, {
        ...change,
        scope: { ...change.scope },
        previous: copyConnectionState(change.previous),
        next: copyConnectionState(change.next),
      });
    }
  };

  const enqueueConnectionScopeReconcile = (
    label: string,
    loadScopes: () => ProviderConnectionScope[],
  ): Promise<void> => {
    connectionStateReconcileQueue = connectionStateReconcileQueue
      .then(async () => {
        const scopes = loadScopes();
        for (const scope of scopes) {
          try {
            await reconcileConnectionScope(scope);
          } catch (error) {
            logger?.(`provider connection state reconcile failed for ${scope.origin} ${scope.namespace}`, error);
          }
        }
      })
      .catch((error) => {
        logger?.(`provider connection state reconcile failed: ${label}`, error);
      });

    return connectionStateReconcileQueue;
  };

  const reconcileAllActiveConnectionScopes = (label: string) =>
    enqueueConnectionScopeReconcile(label, listActiveConnectionScopes);

  const activateConnectionScope = async (input: ProviderConnectionScope): Promise<ProviderRuntimeConnectionState> => {
    const scope = parseProviderConnectionScope(input);
    await initializeProviderChainSelection(scope);
    const state = await readConnectionStateForScope(scope);
    setActiveScopeState(scope, state);
    return copyConnectionState(state);
  };

  const deactivateConnectionScope = (input: ProviderConnectionScope) => {
    deleteActiveScopeState(parseProviderConnectionScope(input));
  };

  const subscribeConnectionStateChanged = (listener: ProviderConnectionStateChangedHandler) => {
    return messenger.subscribe(PROVIDER_CONNECTION_STATE_CHANGED, (change) => {
      listener({
        scope: { ...change.scope },
        previous: copyConnectionState(change.previous),
        next: copyConnectionState(change.next),
        changed: { ...change.changed },
      });
    });
  };

  subscribeProviderChainSelectionChanged((payload) => {
    void enqueueConnectionScopeReconcile("provider_chain_selection_changed", () =>
      selectActiveConnectionScopes((scope) => scope.origin === payload.origin && scope.namespace === payload.namespace),
    );
  });
  subscribeChainRpcStateChanged(() => {
    void reconcileAllActiveConnectionScopes("chain_rpc_state_changed");
  });
  subscribeSessionUnlocked(() => {
    void reconcileAllActiveConnectionScopes("session_unlocked");
  });
  subscribeSessionLocked(() => {
    void reconcileAllActiveConnectionScopes("session_locked");
  });
  subscribeAccountsStateChanged(() => {
    void reconcileAllActiveConnectionScopes("accounts_state_changed");
  });
  subscribePermissionsStateChanged(() => {
    void reconcileAllActiveConnectionScopes("permissions_state_changed");
  });

  const cancelRequestScope = async (input: ProviderRuntimeRequestScope) => {
    const [requestCount] = await Promise.all([
      providerRequests.cancelScope(input, "caller_disconnected"),
      approvals.cancelScope(
        {
          transport: "provider",
          origin: input.origin,
          portId: input.portId,
          sessionId: input.sessionId,
        },
        "caller_disconnected",
      ),
    ]);
    return requestCount;
  };

  return {
    buildSnapshot,
    buildConnectionState,
    activateConnectionScope,
    deactivateConnectionScope,
    subscribeConnectionStateChanged,
    subscribeSessionUnlocked,
    subscribeSessionLocked,
    request,
    encodeRuntimeRpcError,
    listPermittedAccounts,
    cancelRequestScope,
  };
};
