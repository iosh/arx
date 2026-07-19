import { Accounts } from "../accounts/Accounts.js";
import { loadAccountsBootstrap } from "../accounts/bootstrap.js";
import { AccountNotFoundError } from "../accounts/errors.js";
import { ApprovalQueue } from "../approvals/queue/ApprovalQueue.js";
import { ChainJsonRpc } from "../chainJsonRpc/ChainJsonRpc.js";
import { ChainJsonRpcResponseError } from "../chainJsonRpc/errors.js";
import { buildChainAddressingByNamespace } from "../chains/addressing.js";
import { parseChainRef } from "../chains/caip.js";
import { createNetworks, loadNetworksBootstrap } from "../chains/index.js";
import type { WalletChainSelectionDefaults } from "../chains/selection.js";
import type { JsonValue } from "../errors.js";
import { loadKeyringBootstrap } from "../keyring/bootstrap.js";
import { Keyring } from "../keyring/Keyring.js";
import { createMessenger } from "../messenger/Messenger.js";
import { createEip155AccountSigning } from "../namespaces/eip155/accountSigning.js";
import { createPermissions } from "../permissions/Permissions.js";
import { createCoreMutationQueue } from "../persistence/mutationQueue.js";
import type { ProviderConnectionQuery, ProviderConnectionState, ProviderRpcError } from "../provider/access/types.js";
import { createProviderChainSelections } from "../provider/chainSelection.js";
import { systemTime } from "../runtime/time.js";
import { createTransactions, loadTransactionsBootstrap } from "../transactions/index.js";
import { createEip155TransactionAdapter } from "../transactions/namespace/eip155/adapter.js";
import { loadVaultBootstrap } from "../vault/bootstrap.js";
import { loadWalletBootstrap } from "../wallet/bootstrap.js";
import { createWallet } from "../wallet/Wallet.js";
import type { CoreRuntime, CoreRuntimeChanged, CreateCoreRuntimeInput } from "./coreRuntime.js";
import { NamespaceDefinitionRequiredError } from "./errors.js";

const createWalletSelectionDefaults = (
  definitions: CreateCoreRuntimeInput["namespaces"]["definitions"],
): WalletChainSelectionDefaults => {
  const chainRefByNamespace: Record<string, string> = {};
  for (const definition of definitions) {
    const seed = definition.builtinChains[0];
    if (seed) chainRefByNamespace[definition.namespace] = seed.definition.chainRef;
  }
  const activeNamespace = definitions.find((definition) => chainRefByNamespace[definition.namespace])?.namespace;
  if (!activeNamespace) throw new NamespaceDefinitionRequiredError();
  return { activeNamespace, chainRefByNamespace };
};

const chainIdFor = (chainRef: string): string => {
  const parsed = parseChainRef(chainRef);
  if (parsed.namespace === "eip155") return `0x${BigInt(parsed.reference).toString(16)}`;
  return parsed.reference;
};

const encodeProviderError = (error: unknown): ProviderRpcError => {
  if (error instanceof ChainJsonRpcResponseError) {
    return {
      kind: "JsonRpcError",
      code: error.rpcCode,
      message: error.message,
      ...(error.rpcData !== undefined ? { data: error.rpcData as JsonValue } : {}),
    };
  }
  if (error && typeof error === "object" && "code" in error && typeof error.code === "string") {
    return { kind: "ArxError", code: error.code };
  }
  return { kind: "JsonRpcError", code: -32603, message: "Internal error" };
};

export const createCoreRuntime = async (input: CreateCoreRuntimeInput): Promise<CoreRuntime> => {
  const namespaceDefinitions = [...input.namespaces.definitions];
  if (namespaceDefinitions.length === 0) throw new NamespaceDefinitionRequiredError();
  const namespaceNames = new Set(namespaceDefinitions.map((definition) => definition.namespace));
  const accountsAdapters = Object.fromEntries(
    namespaceDefinitions.map((definition) => [definition.namespace, definition.accounts]),
  );
  const chainAddressing = buildChainAddressingByNamespace(
    namespaceDefinitions.map((definition) => definition.chainAddressing),
  );
  const builtinChains = namespaceDefinitions.flatMap((definition) => definition.builtinChains);
  const mutations = createCoreMutationQueue(input.persistence.writer);
  const listeners = new Set<(event: CoreRuntimeChanged) => void>();
  const publish = (event: CoreRuntimeChanged) => {
    for (const listener of listeners) listener(event);
  };
  const walletSelectionDefaults =
    input.defaults?.walletSelection ?? createWalletSelectionDefaults(namespaceDefinitions);

  const [
    vaultBootstrap,
    walletBootstrap,
    keyringBootstrap,
    accountsBootstrap,
    networksBootstrap,
    transactionsBootstrap,
  ] = await Promise.all([
    loadVaultBootstrap(input.persistence.readers),
    loadWalletBootstrap(input.persistence.readers),
    loadKeyringBootstrap(input.persistence.readers),
    loadAccountsBootstrap(input.persistence.readers),
    loadNetworksBootstrap({
      readers: input.persistence.readers,
      builtinSeeds: builtinChains,
      walletSelectionDefaults,
    }),
    loadTransactionsBootstrap(input.persistence.readers),
  ]);

  const unlockedListeners = new Set<(payload: { at: number }) => void>();
  const lockedListeners = new Set<(payload: { at: number; reason: "manual" }) => void>();
  const keyring = new Keyring(keyringBootstrap);
  const accounts = new Accounts({
    adapters: accountsAdapters,
    bootstrap: accountsBootstrap,
    mutations,
    publishChanged: (change) => publish({ owner: "accounts", change }),
  });
  const wallet = createWallet({
    mutations,
    keyring,
    accounts,
    adapters: Object.fromEntries(namespaceDefinitions.map((definition) => [definition.namespace, definition.keyring])),
    time: systemTime,
    vaultBootstrap,
    walletBootstrap,
    publishStatusChanged: (change) => {
      if (change.type === "walletStatusChanged") {
        const at = systemTime.now();
        if (change.status === "unlocked") {
          for (const listener of unlockedListeners) listener({ at });
        } else if (change.status === "locked") {
          for (const listener of lockedListeners) listener({ at, reason: "manual" });
        }
      }

      publish({ owner: "wallet", change });
    },
    publishKeyringChanged: () => publish({ owner: "keyring", change: { type: "keyringChanged" } }),
    publishAccountsChanged: (change) => publish({ owner: "accounts", change }),
  });
  const networks = createNetworks({
    mutations,
    bootstrap: networksBootstrap,
    publishChanged: (change) => {
      publish({ owner: "networks", change });
    },
  });
  const providerChainSelections = createProviderChainSelections({
    reader: input.persistence.readers.providerChainSelections,
    mutations,
    networks,
  });
  const permissions = createPermissions({
    readers: input.persistence.readers,
    mutations,
    publishChanged: () => publish({ owner: "permissions" }),
  });
  const chainJsonRpc = new ChainJsonRpc({
    ...(input.rpc?.options ?? {}),
    endpoints: {
      getRpcEndpoints: (chainRef) => networks.getRpcEndpoints(chainRef),
    },
  });
  const transactionAdapters = new Map();
  if (namespaceNames.has("eip155")) {
    const accountSigning = createEip155AccountSigning({
      keyring,
      accounts,
    });
    transactionAdapters.set(
      "eip155",
      createEip155TransactionAdapter({
        chainJsonRpc,
        chains: chainAddressing,
        accounts,
        accountSigning,
      }),
    );
  }
  const transactions = await createTransactions({
    readers: input.persistence.readers,
    mutations,
    adapters: transactionAdapters,
    bootstrap: transactionsBootstrap,
    publishChanged: (change) => publish({ owner: "transactions", change }),
  });
  transactions.monitor.start();
  const messenger = createMessenger();
  const approvals = new ApprovalQueue({ messenger });
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
    const selection = (await providerChainSelections.get(query)) ?? (await providerChainSelections.initialize(query));
    const accountIds = await permissions.listAccountIds({ ...query, chainRef: selection.chainRef });
    const addresses =
      wallet.getStatus() === "unlocked"
        ? accountIds.flatMap((accountId) => {
            const account = accounts.getAccount(accountId);
            if (!account) throw new AccountNotFoundError(accountId);
            if (account.hidden) return [];

            return [accounts.getAddress({ accountId, chainRef: selection.chainRef }).canonicalAddress];
          })
        : [];
    return {
      snapshot: {
        namespace: query.namespace,
        chain: { chainRef: selection.chainRef, chainId: chainIdFor(selection.chainRef) },
        isUnlocked: wallet.getStatus() === "unlocked",
      },
      accounts: addresses,
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
          (await providerChainSelections.get({ origin: request.scope.origin, namespace: request.namespace })) ??
          (await providerChainSelections.initialize({
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
          result = await chainJsonRpc.request({
            chainRef: selection.chainRef,
            method,
            replay: "never",
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
      void wallet.lock();
      listeners.clear();
      connectionListeners.clear();
      unlockedListeners.clear();
      lockedListeners.clear();
    },
  };
};
