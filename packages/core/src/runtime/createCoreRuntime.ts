import { Accounts } from "../accounts/Accounts.js";
import type { AccountsNamespaceAdapters } from "../accounts/namespaceAdapter.js";
import { Approvals } from "../approvals/Approvals.js";
import { createAssets } from "../assets/Assets.js";
import { createChainJsonRpc } from "../chainJsonRpc/ChainJsonRpc.js";
import { createJsonRpcHttpTransport } from "../chainJsonRpc/JsonRpcHttpTransport.js";
import { type DappConnectionStateChanged, DappConnections } from "../dappConnections/DappConnections.js";
import type { DappConnectionScopeInput, DappConnectionsApi } from "../dappConnections/DappConnectionsApi.js";
import { RpcUnsupportedMethodError } from "../dappConnections/errors.js";
import { type DappNamespaces, routeDappRequest } from "../dappConnections/routeDappRequest.js";
import { Keyring } from "../keyring/Keyring.js";
import type { KeyringNamespaceAdapters } from "../keyring/namespaceAdapter.js";
import { createEip155AccountSigning } from "../namespaces/eip155/accountSigning.js";
import { eip155AccountsAdapter } from "../namespaces/eip155/accounts.js";
import { createEip155AssetsAdapter } from "../namespaces/eip155/assets.js";
import { EIP155_DEFAULT_CHAIN_REF, EIP155_NAMESPACE } from "../namespaces/eip155/constants.js";
import { createEip155DappNamespace } from "../namespaces/eip155/dappRequests.js";
import { eip155KeyringAdapter } from "../namespaces/eip155/keyring.js";
import { createEip155NetworksAdapter } from "../namespaces/eip155/networks.js";
import { isSupportedNamespace, type Namespace, SUPPORTED_NAMESPACES } from "../namespaces/types.js";
import type { ChainRef } from "../networks/chainRef.js";
import { Networks } from "../networks/Networks.js";
import type { NetworksNamespaceAdapters } from "../networks/namespaceAdapter.js";
import { createCustomNetworkRemoval } from "../networks/removeCustomNetwork.js";
import { createDappAuthorization } from "../permissions/createDappAuthorization.js";
import { Permissions } from "../permissions/Permissions.js";
import type { DappScope } from "../permissions/scope.js";
import { createCoreMutationQueue } from "../persistence/mutationQueue.js";
import { createEip155TransactionsAdapter } from "../transactions/eip155/adapter.js";
import type { TransactionsNamespaceAdapters } from "../transactions/namespaceAdapter.js";
import { TransactionMonitor } from "../transactions/TransactionMonitor.js";
import { createTransactions } from "../transactions/Transactions.js";
import { AutoLockController } from "../wallet/AutoLockController.js";
import { createAccountKeys } from "../wallet/accountKeys.js";
import type { WalletApiEvent } from "../wallet/WalletApi.js";
import { WalletCoordinator } from "../wallet/WalletCoordinator.js";
import { getWalletStatus } from "../wallet/walletStatus.js";
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

const defaultChainRefs: Readonly<Record<Namespace, ChainRef>> = {
  [EIP155_NAMESPACE]: EIP155_DEFAULT_CHAIN_REF,
};

const parseDappConnectionScope = ({ origin, namespace }: DappConnectionScopeInput): DappScope => {
  if (!isSupportedNamespace(namespace)) {
    throw new RpcUnsupportedMethodError({ message: `Namespace "${namespace}" has no dapp implementation.` });
  }
  return { origin, namespace };
};

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
  const networkAdapters = { [EIP155_NAMESPACE]: eip155NetworksAdapter } satisfies NetworksNamespaceAdapters;

  const keyring = new Keyring({
    bootstrap: bootstrap.keyring,
    namespaceAdapters: keyringAdapters,
    mutations,
    publishChanged: publishWalletEvent,
  });
  const autoLock = new AutoLockController({
    durationMs: bootstrap.wallet.autoLockDurationMs,
    time: systemTime,
  });
  const walletStatusReader = {
    getStatus: () => getWalletStatus(keyring.getSoftwareKeyStatus(), autoLock.isExpired()),
  };
  const accounts = new Accounts({
    adapters: accountAdapters,
    bootstrap: bootstrap.accounts,
    mutations,
    publishChanged: publishWalletEvent,
  });
  const networks = new Networks({
    adapters: networkAdapters,
    bootstrap: bootstrap.networks,
    mutations,
    publishChanged: publishWalletEvent,
  });
  const permissions = new Permissions({
    bootstrap: bootstrap.permissions,
    accounts,
    publishChanged: publishWalletEvent,
  });
  const dappConnections = new DappConnections({
    bootstrap: bootstrap.dappConnections,
    defaultChainRefs,
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
  const accountKeys = createAccountKeys({ keyring, accounts, wallet: walletStatusReader });
  const eip155AccountSigning = createEip155AccountSigning(accountKeys);
  const chainJsonRpc = createChainJsonRpc({
    endpoints: networks,
    transport: jsonRpcHttpTransport,
  });
  const assets = createAssets({
    accounts,
    networks,
    adapters: { [EIP155_NAMESPACE]: createEip155AssetsAdapter({ chainJsonRpc }) },
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
    namespaces: SUPPORTED_NAMESPACES,
    time: systemTime,
    keyring,
    accounts,
    accountKeys,
    permissions,
    approvals,
    dappConnections,
    autoLock,
    publishStatusChanged: publishWalletEvent,
  });
  const dappAuthorization = createDappAuthorization({
    mutations,
    wallet: walletStatusReader,
    accounts,
    permissions,
    dappConnections,
    approvals,
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
  } satisfies DappNamespaces;
  const customNetworkRemoval = createCustomNetworkRemoval({
    mutations,
    networks,
    transactions: input.persistence.readers.transactions,
    dappConnections,
  });
  const walletApi = createWalletApi({
    subscribe: (listener) => {
      walletEventListeners.add(listener);
      return () => {
        walletEventListeners.delete(listener);
      };
    },
    autoLock,
    coordinator: walletCoordinator,
    keyring,
    accounts,
    networks,
    customNetworkRemoval,
    assets,
    permissions: dappAuthorization.permissions,
    approvals,
    transactions,
  });
  const dappConnectionsApi: DappConnectionsApi = {
    openConnection: (input) => {
      const scope = parseDappConnectionScope(input);
      return dappConnections.openConnection(scope);
    },
    getConnectionState: (input) => dappConnections.getConnectionState(parseDappConnectionScope(input)),
    closeConnection: (input) => dappAuthorization.closeConnection(parseDappConnectionScope(input)),
    request: async ({ scope: inputScope, method, params }) => {
      const scope = parseDappConnectionScope(inputScope);
      const { chainRef } = dappConnections.getConnectionState(scope);
      return routeDappRequest({
        namespace: scope.namespace,
        namespaceRequests: dappNamespaces[scope.namespace],
        chainJsonRpc,
        request: {
          origin: scope.origin,
          chainRef,
          method,
          ...(params !== undefined ? { params } : {}),
        },
      });
    },
    subscribeStateChanged: (listener) => {
      dappConnectionStateListeners.add(listener);
      return () => {
        dappConnectionStateListeners.delete(listener);
      };
    },
  };

  transactionMonitor.restore(bootstrap.transactions.pendingTransactions);

  return { wallet: walletApi, dappConnections: dappConnectionsApi };
};
