import { Accounts } from "../accounts/Accounts.js";
import { loadAccountsBootstrap } from "../accounts/bootstrap.js";
import { AccountNotFoundError } from "../accounts/errors.js";
import { Approvals } from "../approvals/Approvals.js";
import type { ApprovalsApi } from "../approvals/types.js";
import { createChainJsonRpc } from "../chainJsonRpc/ChainJsonRpc.js";
import { ChainJsonRpcResponseError } from "../chainJsonRpc/errors.js";
import { createJsonRpcHttpTransport } from "../chainJsonRpc/JsonRpcHttpTransport.js";
import { buildChainAddressingByNamespace } from "../chains/addressing.js";
import { loadDappConnectionsBootstrap } from "../dappConnections/bootstrap.js";
import { DappConnections } from "../dappConnections/DappConnections.js";
import { dappConnectionScopeKey } from "../dappConnections/scope.js";
import type { JsonValue } from "../errors.js";
import { generateBip39Mnemonic } from "../keyring/bip39.js";
import { loadKeyringBootstrap } from "../keyring/bootstrap.js";
import { HdKeyringNotFoundError, KeySourceNotFoundError } from "../keyring/errors.js";
import { Keyring } from "../keyring/Keyring.js";
import { createEip155AccountSigning } from "../namespaces/eip155/accountSigning.js";
import { createEip155NetworksAdapter } from "../namespaces/eip155/networks.js";
import { loadNetworksBootstrap } from "../networks/bootstrap.js";
import { parseChainRef } from "../networks/chainRef.js";
import { NetworkNamespaceUnsupportedError } from "../networks/errors.js";
import { Networks } from "../networks/Networks.js";
import type { NetworksNamespaceAdapters } from "../networks/namespaceAdapter.js";
import { loadPermissionsBootstrap } from "../permissions/bootstrap.js";
import { Permissions } from "../permissions/Permissions.js";
import { createCoreMutationQueue } from "../persistence/mutationQueue.js";
import type { ProviderConnectionQuery, ProviderConnectionState, ProviderRpcError } from "../provider/access/types.js";
import { systemTime } from "../runtime/time.js";
import { createTransactions, loadTransactionsBootstrap } from "../transactions/index.js";
import { createEip155TransactionAdapter } from "../transactions/namespace/eip155/adapter.js";
import { loadVaultBootstrap } from "../vault/bootstrap.js";
import { Vault } from "../vault/Vault.js";
import { AutoLockController } from "../wallet/AutoLockController.js";
import { loadWalletBootstrap } from "../wallet/bootstrap.js";
import type { Wallet } from "../wallet/Wallet.js";
import { WalletCoordinator } from "../wallet/WalletCoordinator.js";
import type { CoreRuntime, CoreRuntimeChanged, CreateCoreRuntimeInput } from "./coreRuntime.js";
import { NamespaceDefinitionRequiredError } from "./errors.js";

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
  const rpcOptions = input.rpc?.options;
  const jsonRpcHttpTransport =
    rpcOptions?.transport ??
    createJsonRpcHttpTransport({
      ...(rpcOptions?.fetch ? { fetch: rpcOptions.fetch } : {}),
      ...(rpcOptions?.abortController ? { abortController: rpcOptions.abortController } : {}),
    });
  const eip155NetworksAdapter = createEip155NetworksAdapter({
    transport: jsonRpcHttpTransport,
  });
  const networksAdapters = [eip155NetworksAdapter] as const satisfies NetworksNamespaceAdapters;
  const namespaceNames = new Set(namespaceDefinitions.map((definition) => definition.namespace));
  const accountsAdapters = Object.fromEntries(
    namespaceDefinitions.map((definition) => [definition.namespace, definition.accounts]),
  );
  const keyringAdapters = Object.fromEntries(
    namespaceDefinitions.map((definition) => [definition.namespace, definition.keyring]),
  );
  const chainAddressing = buildChainAddressingByNamespace(
    namespaceDefinitions.map((definition) => definition.chainAddressing),
  );
  const mutations = createCoreMutationQueue(input.persistence.writer);
  const listeners = new Set<(event: CoreRuntimeChanged) => void>();
  const publish = (event: CoreRuntimeChanged) => {
    for (const listener of listeners) listener(event);
  };
  const [
    vaultBootstrap,
    walletBootstrap,
    keyringBootstrap,
    accountsBootstrap,
    networksBootstrap,
    dappConnectionsBootstrap,
    permissionsBootstrap,
    transactionsBootstrap,
  ] = await Promise.all([
    loadVaultBootstrap(input.persistence.readers),
    loadWalletBootstrap(input.persistence.readers),
    loadKeyringBootstrap(input.persistence.readers),
    loadAccountsBootstrap(input.persistence.readers),
    loadNetworksBootstrap(input.persistence.readers),
    loadDappConnectionsBootstrap(input.persistence.readers),
    loadPermissionsBootstrap(input.persistence.readers),
    loadTransactionsBootstrap(input.persistence.readers),
  ]);

  const unlockedListeners = new Set<(payload: { at: number }) => void>();
  const lockedListeners = new Set<(payload: { at: number; reason: "manual" }) => void>();
  const vault = new Vault(vaultBootstrap.encryptedVault);
  const keyring = new Keyring({ bootstrap: keyringBootstrap, namespaceAdapters: keyringAdapters });
  const accounts = new Accounts({
    adapters: accountsAdapters,
    bootstrap: accountsBootstrap,
    mutations,
    publishChanged: (change) => publish({ owner: "accounts", change }),
  });
  const autoLock = new AutoLockController({
    durationMs: walletBootstrap.autoLockDurationMs,
    time: systemTime,
  });
  const walletCoordinator = new WalletCoordinator({
    mutations,
    time: systemTime,
    vault,
    keyring,
    accounts,
    autoLock,
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
    publishKeyringChanged: (change) => publish({ owner: "keyring", change }),
    publishAccountsChanged: (change) => publish({ owner: "accounts", change }),
  });
  const wallet: Wallet = {
    getStatus: () => vault.getStatus(),
    getAutoLockDuration: () => autoLock.getDuration(),
    createFromMnemonic: (params) => walletCoordinator.createFromMnemonic(params),
    restoreFromMnemonic: (params) => walletCoordinator.restoreFromMnemonic(params),
    createFromPrivateKey: (params) => walletCoordinator.createFromPrivateKey(params),
    unlock: (password) => walletCoordinator.unlock(password),
    lock: () => walletCoordinator.lock(),
    changePassword: (params) => walletCoordinator.changePassword(params),
    setAutoLockDuration: (durationMs) => walletCoordinator.setAutoLockDuration(durationMs),
    keySources: {
      generateMnemonic: () => ({ mnemonic: generateBip39Mnemonic() }),
      get: (keySourceId) => {
        const keySource = keyring.getKeySource(keySourceId);
        if (!keySource) throw new KeySourceNotFoundError(keySourceId);
        return keySource;
      },
      list: () => keyring.listKeySources(),
      addMnemonic: (params) => walletCoordinator.addMnemonic(params),
      importMnemonic: (params) => walletCoordinator.importMnemonic(params),
      importPrivateKey: (params) => walletCoordinator.importPrivateKey(params),
      confirmMnemonicBackup: (params) => walletCoordinator.confirmMnemonicBackup(params),
      exportMnemonic: (params) => walletCoordinator.exportMnemonic(params),
      exportPrivateKey: (params) => walletCoordinator.exportPrivateKey(params),
    },
    hdKeyrings: {
      get: (hdKeyringId) => {
        const hdKeyring = keyring.getHdKeyring(hdKeyringId);
        if (!hdKeyring) throw new HdKeyringNotFoundError(hdKeyringId);
        return hdKeyring;
      },
      list: () => keyring.listHdKeyrings(),
      add: (params) => walletCoordinator.addHdKeyring(params),
      deriveAccount: (params) => walletCoordinator.deriveHdAccount(params),
    },
    accounts: {
      get: (accountId) => {
        const account = accounts.getAccount(accountId);
        if (!account) throw new AccountNotFoundError(accountId);
        return account;
      },
      list: () => accounts.listAccounts(),
      getAddress: (params) => accounts.getAddress(params),
      listAddresses: (chainRef) => accounts.listAddresses(chainRef),
      rename: (params) => accounts.rename(params),
      select: (params) => accounts.select(params.accountId),
    },
  };
  const networks = new Networks({
    adapters: networksAdapters,
    defaultNamespace: eip155NetworksAdapter.namespace,
    bootstrap: networksBootstrap,
    mutations,
    publishChanged: (change) => publish({ owner: "networks", change }),
  });
  const dappConnections = new DappConnections({
    bootstrap: dappConnectionsBootstrap,
    networks,
    mutations,
  });
  const permissions = new Permissions({
    bootstrap: permissionsBootstrap,
    accounts,
    dappConnections,
  });
  const chainJsonRpc = createChainJsonRpc({
    ...(rpcOptions ?? {}),
    transport: jsonRpcHttpTransport,
    endpoints: networks,
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
  const approvals = new Approvals({
    time: systemTime,
    publishChanged: (change) => publish({ owner: "approvals", change }),
  });
  const approvalsApi: ApprovalsApi = {
    get: (approvalId) => approvals.get(approvalId),
    list: () => approvals.list(),
    approve: (decision) => approvals.approve(decision),
    reject: (approvalId) => approvals.reject(approvalId),
  };

  const activeConnections = new Map<string, ProviderConnectionState>();
  const connectionListeners = new Set<
    (
      change: Parameters<CoreRuntime["provider"]["subscribeConnectionStateChanged"]>[0] extends (input: infer T) => void
        ? T
        : never,
    ) => void
  >();
  const getConnectionChainRef = (query: ProviderConnectionQuery) => {
    const storedSelection = dappConnections.getNetworkSelection(query);
    if (storedSelection) return storedSelection.chainRef;

    const chainRef = networks.getSelection().selectedChainRefByNamespace[query.namespace];
    if (!chainRef) throw new NetworkNamespaceUnsupportedError(query.namespace);
    return chainRef;
  };
  const buildConnectionState = async (query: ProviderConnectionQuery): Promise<ProviderConnectionState> => {
    const chainRef = getConnectionChainRef(query);
    const accountIds = permissions.get(query)?.accountIds ?? [];
    const addresses =
      wallet.getStatus() === "unlocked"
        ? accountIds.map((accountId) => accounts.getAddress({ accountId, chainRef }).canonicalAddress)
        : [];
    return {
      snapshot: {
        namespace: query.namespace,
        chain: { chainRef, chainId: chainIdFor(chainRef) },
        isUnlocked: wallet.getStatus() === "unlocked",
      },
      accounts: addresses,
    };
  };

  const provider: CoreRuntime["provider"] = {
    getConnectionState: async (query) => ({
      ...(await buildConnectionState(query)),
      connected: activeConnections.has(dappConnectionScopeKey(query)),
    }),
    activateConnectionScope: async (query) => {
      const state = await buildConnectionState(query);
      activeConnections.set(dappConnectionScopeKey(query), state);
      return { ...state, connected: true };
    },
    deactivateConnectionScope: (query) => {
      activeConnections.delete(dappConnectionScopeKey(query));
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
        const chainRef = getConnectionChainRef({
          origin: request.scope.origin,
          namespace: request.namespace,
        });
        const method = request.request.method;
        let result: unknown;
        if (method === "eth_chainId") {
          result = chainIdFor(chainRef);
        } else if (method === "eth_accounts") {
          result = (await buildConnectionState({ origin: request.scope.origin, namespace: request.namespace }))
            .accounts;
        } else {
          result = await chainJsonRpc.request({
            chainRef,
            method,
            replay: "forbidden",
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
    wallet: Object.assign(wallet, { networks, transactions, approvals: approvalsApi }),
    subscribeChanged: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    close: () => {
      transactions.monitor.stop();
      approvals.cancelAll();
      void wallet.lock();
      listeners.clear();
      connectionListeners.clear();
      unlockedListeners.clear();
      lockedListeners.clear();
    },
  };
};
