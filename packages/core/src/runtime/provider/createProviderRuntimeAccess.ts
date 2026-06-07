import type { ChainRef } from "../../chains/ids.js";
import { isArxBaseError } from "../../error.js";
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
import type { StateChangeSubscription } from "../../services/store/_shared/signal.js";
import type { ProviderRequestHandle, ProviderRequests } from "./providerRequests.js";
import type {
  ProviderRuntimeAccess,
  ProviderRuntimeAccountsQuery,
  ProviderRuntimeConnectionQuery,
  ProviderRuntimeConnectionState,
  ProviderRuntimeExecutionContext,
  ProviderRuntimeRequestContext,
  ProviderRuntimeRequestScope,
  ProviderRuntimeRpcContext,
  ProviderRuntimeRpcError,
  ProviderRuntimeRpcRequest,
  ProviderRuntimeRpcResponse,
  ProviderRuntimeSnapshot,
} from "./types.js";

const UNKNOWN_ORIGIN = "unknown://";

type ProviderRuntimeChainView = {
  chainId: string;
  chainRef: ChainRef;
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
  getIsInitialized: () => boolean;
  getSessionStatus: () => { isUnlocked: boolean };
  getActiveChainViewForNamespace: (namespace: string) => ProviderRuntimeChainView;
  buildProviderMeta: (namespace: string) => {
    activeChainByNamespace: Record<string, ChainRef>;
    supportedChains: ChainRef[];
  };
  getActiveChainByNamespace: () => Record<string, ChainRef>;
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
  providerRequests: ProviderRequests;
  subscribeSessionUnlocked: (listener: (payload: UnlockUnlockedPayload) => void) => () => void;
  subscribeSessionLocked: (listener: (payload: UnlockLockedPayload) => void) => () => void;
  subscribeNetworkStateChanged: StateChangeSubscription;
  subscribeNetworkSelectionChanged: StateChangeSubscription;
  subscribeAccountsStateChanged: StateChangeSubscription;
  subscribePermissionsStateChanged: StateChangeSubscription;
};

type BegunProviderRuntimeRequest = {
  kind: "begun";
  providerRequestHandle: ProviderRequestHandle;
  resolvedContext: ProviderRuntimeRpcContext;
  resolvedExecutionContext: ProviderRuntimeExecutionContext;
  invocation: ResolvedRpcInvocationDetails;
};

type PreparedProviderRuntimeRequest =
  | BegunProviderRuntimeRequest
  | {
      kind: "response";
      resolvedContext: ProviderRuntimeRpcContext;
      result: Json;
    };

type ProviderAccessPolicyResult = { kind: "continue" } | { kind: "response"; result: Json };

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

export const createProviderRuntimeAccess = ({
  getIsInitialized,
  getSessionStatus,
  getActiveChainViewForNamespace,
  buildProviderMeta,
  getActiveChainByNamespace,
  listPermittedAccountsView,
  formatAddress,
  resolveInvocationDetails,
  executeRequest: executeCoreRequest,
  isInternalOrigin,
  shouldRequestUnlockAttention,
  requestUnlockAttention,
  isAuthorized,
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

  const encodeRuntimeRpcError = (error: unknown): ProviderRuntimeRpcError => {
    return encodeProviderRuntimeError(error);
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
      throw new RpcInternalError({
        message: "Background runtime is not initialized (call lifecycle.initialize() first).",
      });
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

  const executeRpcRequest = async ({
    origin,
    context,
    execution,
    ...request
  }: ProviderRuntimeRpcRequest): Promise<ProviderRuntimeRpcResponse> => {
    let providerRequestHandle: ProviderRequestHandle | null = null;

    const buildErrorResponse = (error: unknown): ProviderRuntimeRpcResponse => ({
      id: request.id,
      jsonrpc: request.jsonrpc,
      error: encodeRuntimeRpcError(error),
    });

    const prepareRequest = (): PreparedProviderRuntimeRequest => {
      const requestScope = execution.requestScope;
      const invocationHint = buildRpcInvocationHint(context);
      const invocation = resolveInvocationDetails(request.method, invocationHint);
      const resolvedContext: ProviderRuntimeRpcContext = {
        providerNamespace: invocation.namespace,
        chainRef: invocation.chainRef,
      };

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
        providerNamespace: invocation.namespace,
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
      const prepared = prepareRequest();
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
    encodeRuntimeRpcError,
    listPermittedAccounts,
    cancelRequestScope,
  };
};
