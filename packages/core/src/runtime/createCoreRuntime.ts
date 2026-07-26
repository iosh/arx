import { Accounts } from "../accounts/Accounts.js";
import type { AccountsNamespaceAdapters } from "../accounts/namespaceAdapter.js";
import { Approvals } from "../approvals/Approvals.js";
import { createChainJsonRpc } from "../chainJsonRpc/ChainJsonRpc.js";
import { createJsonRpcHttpTransport } from "../chainJsonRpc/JsonRpcHttpTransport.js";
import { type DappConnectionStateChanged, DappConnections } from "../dappConnections/DappConnections.js";
import type { DappConnectionsApi } from "../dappConnections/DappConnectionsApi.js";
import { type DappNamespaces, routeChainRpcRequest, routeDappRequest } from "../dappConnections/routeDappRequest.js";
import { Keyring } from "../keyring/Keyring.js";
import type { KeyringNamespaceAdapters } from "../keyring/namespaceAdapter.js";
import { createEip155AccountSigning } from "../namespaces/eip155/accountSigning.js";
import { eip155AccountsAdapter } from "../namespaces/eip155/accounts.js";
import { EIP155_NAMESPACE } from "../namespaces/eip155/constants.js";
import { createEip155DappNamespace } from "../namespaces/eip155/dappRequests.js";
import { eip155KeyringAdapter } from "../namespaces/eip155/keyring.js";
import { createEip155NetworksAdapter } from "../namespaces/eip155/networks.js";
import { Networks } from "../networks/Networks.js";
import type { NetworksNamespaceAdapters } from "../networks/namespaceAdapter.js";
import { createCustomNetworkRemoval } from "../networks/removeCustomNetwork.js";
import { createDappAuthorization } from "../permissions/createDappAuthorization.js";
import { Permissions } from "../permissions/Permissions.js";
import { createCoreMutationQueue } from "../persistence/mutationQueue.js";
import { createEip155TransactionsAdapter } from "../transactions/eip155/adapter.js";
import type { TransactionsNamespaceAdapters } from "../transactions/namespaceAdapter.js";
import { TransactionMonitor } from "../transactions/TransactionMonitor.js";
import { createTransactions } from "../transactions/Transactions.js";
import { Vault } from "../vault/Vault.js";
import { AutoLockController } from "../wallet/AutoLockController.js";
import type { WalletApiEvent, WalletChainRpcApi, WalletChainRpcRequest } from "../wallet/WalletApi.js";
import { WalletCoordinator } from "../wallet/WalletCoordinator.js";
import type { CoreRuntime, CreateCoreRuntimeInput } from "./coreRuntime.js";
import { createWalletApi } from "./createWalletApi.js";
import { loadCoreBootstrap } from "./loadCoreBootstrap.js";
import { systemTime } from "./time.js";

const accountAdapters = {
  [EIP155_NAMESPACE]: eip155AccountsAdapter,
} as const satisfies AccountsNamespaceAdapters;

const keyringAdapters = {
  [EIP155_NAMESPACE]: eip155KeyringAdapter,
} as const satisfies KeyringNamespaceAdapters;

const publishToListeners = <Event>(listeners: ReadonlySet<(event: Event) => void>, event: Event): void => {
  for (const listener of listeners) {
    try {
      listener(event);
    } catch {
      // Subscribers observe committed state and cannot change command settlement.
    }
  }
};

export const createCoreRuntime = async (input: CreateCoreRuntimeInput): Promise<CoreRuntime> => {
  const bootstrap = await loadCoreBootstrap(input.persistence.readers);
  const mutations = createCoreMutationQueue(input.persistence.writer);

  const walletEventListeners = new Set<(event: WalletApiEvent) => void>();
  const publishWalletEvent = (event: WalletApiEvent): void => publishToListeners(walletEventListeners, event);
  const dappConnectionStateListeners = new Set<(change: DappConnectionStateChanged) => void>();
  const publishDappConnectionStateChanged = (change: DappConnectionStateChanged): void =>
    publishToListeners(dappConnectionStateListeners, change);

  const jsonRpcHttpTransport = createJsonRpcHttpTransport();
  const eip155NetworksAdapter = createEip155NetworksAdapter({ transport: jsonRpcHttpTransport });
  const networkAdapters = [eip155NetworksAdapter] as const satisfies NetworksNamespaceAdapters;

  const vault = new Vault(bootstrap.vault.encryptedVault);
  const walletStatusReader = { getStatus: () => vault.getStatus() };
  const keyring = new Keyring({
    bootstrap: bootstrap.keyring,
    namespaceAdapters: keyringAdapters,
  });
  const accounts = new Accounts({
    adapters: accountAdapters,
    bootstrap: bootstrap.accounts,
    mutations,
    publishChanged: publishWalletEvent,
  });
  const networks = new Networks({
    adapters: networkAdapters,
    defaultNamespace: EIP155_NAMESPACE,
    bootstrap: bootstrap.networks,
    mutations,
    publishChanged: publishWalletEvent,
  });
  const permissions = new Permissions({
    bootstrap: bootstrap.permissions,
    accounts,
  });
  const dappConnections = new DappConnections({
    bootstrap: bootstrap.dappConnections,
    accounts,
    networks,
    permissions,
    wallet: walletStatusReader,
    mutations,
    publishStateChanged: publishDappConnectionStateChanged,
  });
  const approvals = new Approvals({
    time: systemTime,
    publishChanged: publishWalletEvent,
  });
  const autoLock = new AutoLockController({
    durationMs: bootstrap.wallet.autoLockDurationMs,
    time: systemTime,
  });

  const eip155AccountSigning = createEip155AccountSigning({ keyring, accounts });
  const chainJsonRpc = createChainJsonRpc({
    endpoints: networks,
    transport: jsonRpcHttpTransport,
  });
  const transactionAdapters = {
    [EIP155_NAMESPACE]: createEip155TransactionsAdapter({
      chainJsonRpc,
      signing: eip155AccountSigning,
      pendingTransactionsReader: input.persistence.readers.transactions,
    }),
  } as const satisfies TransactionsNamespaceAdapters;
  const transactionMonitor = new TransactionMonitor({
    adapters: transactionAdapters,
    mutations,
    time: systemTime,
    publishChanged: publishWalletEvent,
  });
  const transactions = createTransactions({
    readers: input.persistence.readers,
    accounts,
    networks,
    mutations,
    time: systemTime,
    adapters: transactionAdapters,
    monitor: transactionMonitor,
    publishChanged: publishWalletEvent,
  });

  const walletCoordinator = new WalletCoordinator({
    mutations,
    time: systemTime,
    vault,
    keyring,
    accounts,
    permissions,
    approvals,
    dappConnections,
    autoLock,
    publishStatusChanged: publishWalletEvent,
    publishKeyringChanged: publishWalletEvent,
    publishAccountsChanged: publishWalletEvent,
    publishPermissionsChanged: publishWalletEvent,
  });
  const customNetworkRemoval = createCustomNetworkRemoval({
    mutations,
    networks,
    transactions: input.persistence.readers.transactions,
    dappConnections,
  });
  const dappAuthorization = createDappAuthorization({
    mutations,
    wallet: walletStatusReader,
    accounts,
    networks,
    permissions,
    dappConnections,
    approvals,
    publishPermissionsChanged: publishWalletEvent,
  });

  const dappNamespaces = {
    [EIP155_NAMESPACE]: createEip155DappNamespace({
      chainJsonRpc,
      dappConnections,
      dappAuthorization,
      accounts,
      permissions,
      approvals,
      accountSigning: eip155AccountSigning,
      networks,
      transactions,
    }),
  } as const satisfies DappNamespaces;
  const walletChainRpc: WalletChainRpcApi = {
    async request<TResult = unknown>(request: WalletChainRpcRequest): Promise<TResult> {
      return (await routeChainRpcRequest(dappNamespaces, request)) as TResult;
    },
  };

  const walletApi = createWalletApi({
    subscribe: (listener) => {
      walletEventListeners.add(listener);
      return () => {
        walletEventListeners.delete(listener);
      };
    },
    vault,
    autoLock,
    coordinator: walletCoordinator,
    keyring,
    accounts,
    networks,
    customNetworkRemoval,
    chainRpc: walletChainRpc,
    permissions: dappAuthorization.permissions,
    approvals,
    transactions,
  });
  const dappConnectionsApi: DappConnectionsApi = {
    openConnection: (scope) => dappConnections.openConnection(scope),
    getConnectionState: (scope) => dappConnections.getConnectionState(scope),
    closeConnection: (scope) => dappAuthorization.closeConnection(scope),
    request: async ({ scope, method, params }) => {
      const { chainRef } = dappConnections.getConnectionState(scope);
      return routeDappRequest(scope.namespace, dappNamespaces, {
        origin: scope.origin,
        chainRef,
        method,
        ...(params !== undefined ? { params } : {}),
      });
    },
    subscribeStateChanged: (listener) => {
      dappConnectionStateListeners.add(listener);
      return () => {
        dappConnectionStateListeners.delete(listener);
      };
    },
  };

  input.userActivity.subscribe(() => autoLock.recordActivity());
  transactionMonitor.restore(bootstrap.transactions.pendingTransactions);

  return { wallet: walletApi, dappConnections: dappConnectionsApi };
};
