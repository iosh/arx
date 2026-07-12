import type { ApprovalQueueService } from "../../approvals/queue/types.js";
import type { ChainRef } from "../../chains/ids.js";
import type { ProviderChainSelectionChangedHandler } from "../../chains/selection/provider/types.js";
import { isArxBaseError } from "../../errors.js";
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
import { WalletLockedError } from "../../wallet/errors.js";
import { InvalidProviderConnectionScopeError } from "./errors.js";
import type { ProviderRequestHandle, ProviderRequests } from "./providerRequests.js";
import type {
  ProviderAccess,
  ProviderAccountsQuery,
  ProviderConnectionQuery,
  ProviderConnectionScope,
  ProviderConnectionState,
  ProviderConnectionStateChange,
  ProviderConnectionStateChangedHandler,
  ProviderExecutionContext,
  ProviderRequestContext,
  ProviderRequestInput,
  ProviderRequestScope,
  ProviderRpcError,
  ProviderRpcResponse,
  ProviderSnapshot,
  ResolvedProviderRequestContext,
} from "./types.js";

const UNKNOWN_ORIGIN = "unknown://";

type ProviderResolvedChain = {
  chain: {
    chainId: string;
    chainRef: ChainRef;
  };
};

type ProviderExecuteRequest = (args: {
  origin: string;
  request: {
    method: string;
    params?: JsonRpcParams;
  };
  invocation: ResolvedRpcInvocationDetails;
  executionContext: ProviderExecutionContext;
}) => Promise<unknown>;

type ProviderAccessDeps = {
  messenger: Messenger;
  getIsInitialized: () => boolean;
  getSessionStatus: () => { isUnlocked: boolean };
  resolveProviderChain: (input: ProviderConnectionQuery) => ProviderResolvedChain;
  initializeProviderChainSelection: (input: ProviderConnectionScope) => Promise<void>;
  listPermittedAccountsView: (origin: string, options: { chainRef: ChainRef }) => Array<{ canonicalAddress: string }>;
  formatAddress: (input: { chainRef: ChainRef; canonical: string }) => string;
  resolveInvocationDetails: (method: string, hint?: RpcInvocationHint) => ResolvedRpcInvocationDetails;
  executeRequest: ProviderExecuteRequest;
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
  subscribeSessionUnlocked: (listener: (payload: { at: number }) => void) => () => void;
  subscribeSessionLocked: (listener: (payload: { at: number; reason: "manual" }) => void) => () => void;
  subscribeChainRpcStateChanged: (listener: () => void) => () => void;
  subscribeProviderChainSelectionChanged: (listener: ProviderChainSelectionChangedHandler) => () => void;
  subscribeAccountsStateChanged: (listener: () => void) => () => void;
  subscribePermissionsStateChanged: (listener: () => void) => () => void;
};

type BegunProviderRequest = {
  kind: "begun";
  providerRequestHandle: ProviderRequestHandle;
  resolvedContext: ResolvedProviderRequestContext;
  resolvedExecutionContext: ProviderExecutionContext;
  invocation: ResolvedRpcInvocationDetails;
};

type PreparedProviderRequest =
  | BegunProviderRequest
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

const encodeProviderRpcError = (error: unknown): ProviderRpcError => {
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
  previous: ProviderConnectionState;
  next: ProviderConnectionState;
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

export const createProviderAccess = ({
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
}: ProviderAccessDeps): ProviderAccess => {
  type ActiveConnectionScopeState = {
    scope: ProviderConnectionScope;
    state: ProviderConnectionState;
  };

  const activeScopesByOrigin = new Map<string, Map<string, ActiveConnectionScopeState>>();

  const buildSnapshotForScope = (input: ProviderConnectionScope, isUnlocked: boolean): ProviderSnapshot => {
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

  const buildSnapshot = (input: ProviderConnectionQuery): ProviderSnapshot => {
    return buildSnapshotForScope(parseProviderConnectionScope(input), getSessionStatus().isUnlocked);
  };

  const listPermittedAccountsForState = ({
    origin,
    chainRef,
    isUnlocked,
  }: ProviderAccountsQuery & { isUnlocked: boolean }): string[] => {
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

  const encodeRpcError = (error: unknown): ProviderRpcError => {
    return encodeProviderRpcError(error);
  };

  const copyConnectionState = (state: ProviderConnectionState): ProviderConnectionState => ({
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

  const setActiveScopeState = (scope: ProviderConnectionScope, state: ProviderConnectionState) => {
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

    requestUnlockAttention(args);
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
        throw new WalletLockedError();
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
          throw new WalletLockedError();
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

  const request = async ({ scope, namespace, request }: ProviderRequestInput): Promise<ProviderRpcResponse> => {
    const origin = scope.origin;
    let providerRequestHandle: ProviderRequestHandle | null = null;

    const buildErrorResponse = (error: unknown): ProviderRpcResponse => ({
      id: request.id,
      jsonrpc: request.jsonrpc,
      error: encodeRpcError(error),
    });

    const prepareRequest = async (): Promise<PreparedProviderRequest> => {
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

      const requestContext: ProviderRequestContext = {
        transport: requestScope.transport,
        origin: requestScope.origin,
        portId: requestScope.portId,
        sessionId: requestScope.sessionId,
        requestId: providerRequestHandle.id,
      };

      const resolvedExecutionContext: ProviderExecutionContext = {
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

    const runRequest = async (begun: BegunProviderRequest): Promise<ProviderRpcResponse> => {
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

  const listPermittedAccounts = async ({ origin, chainRef }: ProviderAccountsQuery): Promise<string[]> => {
    return listPermittedAccountsForState({
      origin,
      chainRef,
      isUnlocked: getSessionStatus().isUnlocked,
    });
  };

  const readConnectionStateForScope = (scope: ProviderConnectionScope): ProviderConnectionState => {
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
  }: ProviderConnectionQuery): Promise<ProviderConnectionState> => {
    return readConnectionStateForScope(parseProviderConnectionScope({ origin, namespace }));
  };

  const reconcileConnectionScope = (scope: ProviderConnectionScope) => {
    const activeState = getActiveScopeState(scope);
    if (!activeState) {
      return;
    }

    const next = readConnectionStateForScope(scope);
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

  const enqueueConnectionScopeReconcile = (loadScopes: () => ProviderConnectionScope[]): void => {
    const scopes = loadScopes();
    for (const scope of scopes) {
      reconcileConnectionScope(scope);
    }
  };

  const reconcileAllActiveConnectionScopes = () => enqueueConnectionScopeReconcile(listActiveConnectionScopes);

  const activateConnectionScope = async (input: ProviderConnectionScope): Promise<ProviderConnectionState> => {
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
    enqueueConnectionScopeReconcile(() =>
      selectActiveConnectionScopes((scope) => scope.origin === payload.origin && scope.namespace === payload.namespace),
    );
  });
  subscribeChainRpcStateChanged(() => {
    reconcileAllActiveConnectionScopes();
  });
  subscribeSessionUnlocked(() => {
    reconcileAllActiveConnectionScopes();
  });
  subscribeSessionLocked(() => {
    reconcileAllActiveConnectionScopes();
  });
  subscribeAccountsStateChanged(() => {
    reconcileAllActiveConnectionScopes();
  });
  subscribePermissionsStateChanged(() => {
    reconcileAllActiveConnectionScopes();
  });

  const cancelRequestScope = async (input: ProviderRequestScope) => {
    const requestCount = await providerRequests.cancelScope(input, "caller_disconnected");
    approvals.cancelScope(
      {
        transport: "provider",
        origin: input.origin,
        portId: input.portId,
        sessionId: input.sessionId,
      },
      "caller_disconnected",
    );
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
    encodeRpcError,
    listPermittedAccounts,
    cancelRequestScope,
  };
};
