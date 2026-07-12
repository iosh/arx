import { canonicalChainAddressFromAccountId } from "../accounts/addressing/accountId.js";
import { InMemoryApprovalQueueService } from "../approvals/queue/InMemoryApprovalQueueService.js";
import { parseChainRef } from "../chains/caip.js";
import { createNetworks, loadNetworksBootstrap } from "../chains/index.js";
import type { WalletChainSelectionDefaults } from "../chains/WalletChainSelection.js";
import type { JsonValue } from "../errors.js";
import { createWalletAccountSigning } from "../keyring/accountSigning.js";
import { createMessenger } from "../messenger/Messenger.js";
import { assembleNamespaceStatic } from "../namespaces/index.js";
import { createPermissions } from "../permissions/Permissions.js";
import { createCoreMutationQueue } from "../persistence/mutationQueue.js";
import type { ProviderConnectionQuery, ProviderConnectionState, ProviderRpcError } from "../provider/access/types.js";
import { ChainRpcClientPool } from "../rpc/ChainRpcClientPool.js";
import { JsonRpcResponseError } from "../rpc/jsonRpcError.js";
import { createTransactions, loadTransactionsBootstrap } from "../transactions/index.js";
import { loadVaultBootstrap } from "../vault/bootstrap.js";
import { createWallet } from "../wallet/Wallet.js";
import type { CoreRuntime, CoreRuntimeChanged, CreateCoreRuntimeInput } from "./coreRuntime.js";
import { WalletNamespaceManifestRequiredError } from "./errors.js";

const DEFAULT_AUTO_LOCK_DURATION_MS = 15 * 60_000;

const createWalletSelectionDefaults = (
  manifests: CreateCoreRuntimeInput["namespaces"]["manifests"],
): WalletChainSelectionDefaults => {
  const chainRefByNamespace: Record<string, string> = {};
  for (const manifest of manifests) {
    const seed = manifest.core.chainSeeds?.[0];
    if (seed) chainRefByNamespace[manifest.namespace] = seed.definition.chainRef;
  }
  const activeNamespace = manifests.find((manifest) => chainRefByNamespace[manifest.namespace])?.namespace;
  if (!activeNamespace) throw new WalletNamespaceManifestRequiredError();
  return { activeNamespace, chainRefByNamespace };
};

const chainIdFor = (chainRef: string): string => {
  const parsed = parseChainRef(chainRef);
  if (parsed.namespace === "eip155") return `0x${BigInt(parsed.reference).toString(16)}`;
  return parsed.reference;
};

const encodeProviderError = (error: unknown): ProviderRpcError => {
  if (error instanceof JsonRpcResponseError) {
    return {
      kind: "JsonRpcError",
      code: error.code,
      message: error.message,
      ...(error.data !== undefined ? { data: error.data as JsonValue } : {}),
    };
  }
  if (error && typeof error === "object" && "code" in error && typeof error.code === "string") {
    return { kind: "ArxError", code: error.code };
  }
  return { kind: "JsonRpcError", code: -32603, message: "Internal error" };
};

export const createCoreRuntime = async (input: CreateCoreRuntimeInput): Promise<CoreRuntime> => {
  const manifests = [...input.namespaces.manifests];
  if (manifests.length === 0) throw new WalletNamespaceManifestRequiredError();
  const namespaceStatic = assembleNamespaceStatic(manifests);
  const mutations = createCoreMutationQueue(input.persistence.writer);
  const listeners = new Set<(event: CoreRuntimeChanged) => void>();
  const publish = (event: CoreRuntimeChanged) => {
    for (const listener of listeners) listener(event);
  };
  const endpointListeners = new Set<(event: { chainRef: string }) => void>();
  const walletSelectionDefaults = input.defaults?.walletSelection ?? createWalletSelectionDefaults(manifests);

  const [vaultBootstrap, networksBootstrap, transactionsBootstrap] = await Promise.all([
    loadVaultBootstrap({
      readers: input.persistence.readers,
      defaultAutoLockDurationMs: input.defaults?.autoLockDurationMs ?? DEFAULT_AUTO_LOCK_DURATION_MS,
    }),
    loadNetworksBootstrap({
      readers: input.persistence.readers,
      builtinSeeds: namespaceStatic.chainSeeds,
      walletSelectionDefaults,
    }),
    loadTransactionsBootstrap(input.persistence.readers),
  ]);

  let previousWalletStatus = vaultBootstrap.encryptedVault ? "locked" : "uninitialized";
  const unlockedListeners = new Set<(payload: { at: number }) => void>();
  const lockedListeners = new Set<(payload: { at: number; reason: "manual" }) => void>();
  const wallet = createWallet({
    readers: input.persistence.readers,
    mutations,
    adapters: new Map(manifests.map((manifest) => [manifest.namespace, manifest.core.keyringAdapter])),
    bootstrap: vaultBootstrap,
    publishChanged: (change) => {
      const nextStatus = wallet.getStatus();
      if (previousWalletStatus !== nextStatus) {
        const at = Date.now();
        if (nextStatus === "unlocked") for (const listener of unlockedListeners) listener({ at });
        if (previousWalletStatus === "unlocked") {
          for (const listener of lockedListeners) listener({ at, reason: "manual" });
        }
        previousWalletStatus = nextStatus;
      }
      publish({ owner: "wallet", change });
    },
  });
  const networks = createNetworks({
    readers: input.persistence.readers,
    mutations,
    bootstrap: networksBootstrap,
    publishChanged: (change) => {
      for (const chainRef of change.rpc ?? []) {
        for (const listener of endpointListeners) listener({ chainRef });
      }
      publish({ owner: "networks", change });
    },
  });
  const permissions = createPermissions({
    readers: input.persistence.readers,
    mutations,
    publishChanged: () => publish({ owner: "permissions" }),
  });
  const accountSigning = createWalletAccountSigning(wallet);
  const rpcClients = new ChainRpcClientPool({
    ...(input.rpc?.options ?? {}),
    chainRpc: {
      getEndpoints: (chainRef) => networks.getRpcEndpoints(chainRef),
      onEndpointsChanged: (listener) => {
        endpointListeners.add(listener);
        return () => endpointListeners.delete(listener);
      },
    },
  });
  for (const manifest of manifests) rpcClients.registerFactory(manifest.namespace, manifest.runtime.clientFactory);
  for (const entry of input.rpc?.factories ?? []) rpcClients.registerFactory(entry.namespace, entry.factory);

  const transactionAdapters = new Map(
    manifests.map((manifest) => [
      manifest.namespace,
      manifest.runtime.createTransactionAdapter({
        rpcClients,
        chains: namespaceStatic.chainAddressing,
        accounts: namespaceStatic.accountAddressing,
        accountSigning,
      }),
    ]),
  );
  const transactions = await createTransactions({
    readers: input.persistence.readers,
    mutations,
    adapters: transactionAdapters,
    bootstrap: transactionsBootstrap,
    publishChanged: (change) => publish({ owner: "transactions", change }),
  });
  transactions.monitor.start();
  const messenger = createMessenger();
  const approvals = new InMemoryApprovalQueueService({ messenger });
  approvals.onStateChanged(() => publish({ owner: "approvals" }));

  const activeConnections = new Map<string, ProviderConnectionState>();
  const connectionListeners = new Set<
    (
      change: Parameters<CoreRuntime["provider"]["subscribeConnectionStateChanged"]>[0] extends (input: infer T) => void
        ? T
        : never,
    ) => void
  >();
  const connectionKey = (query: ProviderConnectionQuery) => `${query.origin}\u0000${query.namespace}`;
  const buildConnectionState = async (query: ProviderConnectionQuery): Promise<ProviderConnectionState> => {
    const selection =
      (await networks.getProviderChainSelection(query)) ?? (await networks.initializeProviderChainSelection(query));
    const accountIds = await permissions.listAccountIds({ ...query, chainRef: selection.chainRef });
    const accounts =
      wallet.getStatus() === "unlocked"
        ? accountIds.map((accountId) =>
            canonicalChainAddressFromAccountId({
              accountId,
              chainRef: selection.chainRef,
              accountAddressing: namespaceStatic.accountAddressing,
            }),
          )
        : [];
    return {
      snapshot: {
        namespace: query.namespace,
        chain: { chainRef: selection.chainRef, chainId: chainIdFor(selection.chainRef) },
        isUnlocked: wallet.getStatus() === "unlocked",
      },
      accounts,
    };
  };

  const provider: CoreRuntime["provider"] = {
    getConnectionState: async (query) => ({
      ...(await buildConnectionState(query)),
      connected: activeConnections.has(connectionKey(query)),
    }),
    activateConnectionScope: async (query) => {
      const state = await buildConnectionState(query);
      activeConnections.set(connectionKey(query), state);
      return { ...state, connected: true };
    },
    deactivateConnectionScope: (query) => {
      activeConnections.delete(connectionKey(query));
    },
    subscribeConnectionStateChanged: (listener) => {
      connectionListeners.add(listener);
      return () => connectionListeners.delete(listener);
    },
    subscribeSessionUnlocked: (listener) => {
      unlockedListeners.add(listener);
      return () => unlockedListeners.delete(listener);
    },
    subscribeSessionLocked: (listener) => {
      lockedListeners.add(listener);
      return () => lockedListeners.delete(listener);
    },
    request: async (request) => {
      try {
        const selection =
          (await networks.getProviderChainSelection({ origin: request.scope.origin, namespace: request.namespace })) ??
          (await networks.initializeProviderChainSelection({
            origin: request.scope.origin,
            namespace: request.namespace,
          }));
        const method = request.request.method;
        let result: unknown;
        if (method === "eth_chainId") {
          result = chainIdFor(selection.chainRef);
        } else if (method === "eth_accounts") {
          result = (await buildConnectionState({ origin: request.scope.origin, namespace: request.namespace }))
            .accounts;
        } else {
          result = await rpcClients.getClient(request.namespace, selection.chainRef).request({
            method,
            ...(request.request.params !== undefined ? { params: request.request.params } : {}),
          });
        }
        return { id: request.request.id, jsonrpc: "2.0", result };
      } catch (error) {
        return { id: request.request.id, jsonrpc: "2.0", error: encodeProviderError(error) };
      }
    },
    encodeRpcError: encodeProviderError,
    cancelRequestScope: async () => 0,
  };

  return {
    provider,
    wallet: Object.assign(wallet, { networks, transactions, approvals }),
    subscribeChanged: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    close: () => {
      transactions.monitor.stop();
      wallet.lock();
      listeners.clear();
      connectionListeners.clear();
      unlockedListeners.clear();
      lockedListeners.clear();
    },
  };
};
