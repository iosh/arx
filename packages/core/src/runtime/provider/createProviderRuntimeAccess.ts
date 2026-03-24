import type { JsonRpcError, JsonRpcParams, JsonRpcRequest, JsonRpcResponse } from "../../rpc/index.js";
import type { BackgroundRuntime } from "../createBackgroundRuntime.js";
import type {
  ProviderRuntimeAccess,
  ProviderRuntimeAccountsQuery,
  ProviderRuntimeConnectionQuery,
  ProviderRuntimeConnectionState,
  ProviderRuntimeErrorContext,
  ProviderRuntimeRpcRequest,
  ProviderRuntimeSnapshot,
} from "./types.js";

type ProviderRuntimeRequestEnvelope = JsonRpcRequest<JsonRpcParams> & {
  origin: string;
};

const UNKNOWN_ORIGIN = "unknown://";

export const createProviderRuntimeAccess = (runtime: BackgroundRuntime): ProviderRuntimeAccess => {
  const resolveMethodNamespace = runtime.rpc.resolveMethodNamespace;
  const getSessionStatus = () => runtime.services.sessionStatus.getStatus();

  const buildSnapshotFromState = (namespace: string, isUnlocked: boolean): ProviderRuntimeSnapshot => {
    const providerMeta = runtime.services.chainViews.buildProviderMeta(namespace);
    const providerChain = runtime.services.chainViews.getProviderChainView(namespace);
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

  const getActiveChainByNamespace = () => runtime.services.networkPreferences.getActiveChainByNamespace();

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

    return runtime.services.permissionViews.listPermittedAccounts(origin, { chainRef }).map((account) =>
      runtime.controllers.chainAddressCodecs.formatAddress({
        chainRef,
        canonical: account.canonicalAddress,
      }),
    );
  };

  const encodeRpcError = (
    error: unknown,
    { origin, method, rpcContext }: ProviderRuntimeErrorContext,
  ): JsonRpcError => {
    return runtime.rpc.errorEncoder.encodeDapp(error, {
      namespace: resolveMethodNamespace(method, rpcContext) ?? null,
      chainRef: rpcContext?.chainRef ?? null,
      origin,
      method,
    }) as JsonRpcError;
  };

  const executeRpcRequest = async ({
    origin,
    arx,
    ...request
  }: ProviderRuntimeRpcRequest): Promise<JsonRpcResponse> => {
    const engineRequest: ProviderRuntimeRequestEnvelope & { arx?: ProviderRuntimeRpcRequest["arx"] } = {
      id: request.id,
      jsonrpc: request.jsonrpc,
      method: request.method,
      origin,
      ...(request.params !== undefined ? { params: request.params } : {}),
      ...(arx ? { arx } : {}),
    };

    const buildErrorResponse = (error: unknown): JsonRpcResponse => ({
      id: request.id,
      jsonrpc: request.jsonrpc,
      error: encodeRpcError(error, {
        origin,
        method: request.method,
        rpcContext: arx,
      }),
    });

    try {
      return await new Promise<JsonRpcResponse>((resolve) => {
        runtime.rpc.engine.handle(engineRequest, (error, response) => {
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

  const cancelSessionApprovals = async (input: { origin: string; portId: string; sessionId: string }) => {
    return await runtime.controllers.approvals.cancelByScope({
      scope: {
        transport: "provider",
        origin: input.origin,
        portId: input.portId,
        sessionId: input.sessionId,
      },
      reason: "session_lost",
    });
  };

  return {
    buildSnapshot,
    buildConnectionState,
    getActiveChainByNamespace,
    subscribeSessionUnlocked: (listener) => runtime.services.session.unlock.onUnlocked(listener),
    subscribeSessionLocked: (listener) => runtime.services.session.unlock.onLocked(listener),
    subscribeNetworkStateChanged: (listener) => runtime.controllers.network.onStateChanged(listener),
    subscribeNetworkPreferencesChanged: (listener) => runtime.services.networkPreferences.subscribeChanged(listener),
    subscribeAccountsStateChanged: (listener) => runtime.controllers.accounts.onStateChanged(listener),
    subscribePermissionsStateChanged: (listener) => runtime.controllers.permissions.onStateChanged(listener),
    executeRpcRequest,
    encodeRpcError,
    listPermittedAccounts,
    cancelSessionApprovals,
  };
};
