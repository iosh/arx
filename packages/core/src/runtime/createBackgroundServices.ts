import type { ChainRef } from "../chains/ids.js";
import type { ChainMetadata } from "../chains/metadata.js";
import { createDefaultChainModuleRegistry } from "../chains/registry.js";
import type { RpcEndpointState } from "../controllers/network/types.js";
import type { SettingsRecord } from "../db/records.js";
import { type CompareFn, ControllerMessenger } from "../messenger/ControllerMessenger.js";
import { EIP155_NAMESPACE } from "../rpc/handlers/namespaces/utils.js";
import type { HandlerControllers, Namespace } from "../rpc/handlers/types.js";
import { createNamespaceResolver, type RpcInvocationContext } from "../rpc/index.js";
import { createApprovalsService } from "../services/approvals/ApprovalsService.js";
import type { ApprovalsPort } from "../services/approvals/port.js";
import { type AttentionServiceMessengerTopics, createAttentionService } from "../services/attention/index.js";
import type { SettingsPort } from "../services/settings/port.js";
import type { TransactionsPort } from "../services/transactions/port.js";
import { createTransactionsService } from "../services/transactions/TransactionsService.js";
import type {
  AccountMeta,
  KeyringMeta,
  KeyringStorePort,
  StorageNamespace,
  StoragePort,
  StorageSnapshotMap,
} from "../storage/index.js";
import { NETWORK_SNAPSHOT_VERSION, StorageNamespaces } from "../storage/index.js";
import { createEip155TransactionAdapter } from "../transactions/adapters/eip155/adapter.js";
import { createEip155Broadcaster } from "../transactions/adapters/eip155/broadcaster.js";
import { createEip155Signer } from "../transactions/adapters/eip155/signer.js";
import { buildDefaultEndpointState, DEFAULT_CHAIN } from "./background/constants.js";
import { type ControllerLayerOptions, initControllers } from "./background/controllers.js";
import { type EngineOptions, initEngine } from "./background/engine.js";
import type { MessengerTopics } from "./background/messenger.js";
import { initRpcLayer, type RpcLayerOptions } from "./background/rpcLayer.js";
import type { BackgroundSessionServices } from "./background/session.js";
import { initSessionLayer, type SessionOptions } from "./background/session.js";
import { createTransactionsLifecycle } from "./background/transactionsLifecycle.js";
import { AccountsKeyringBridge } from "./keyring/AccountsKeyringBridge.js";
import { createStorageSync } from "./persistence/createStorageSync.js";

export type { BackgroundSessionServices } from "./background/session.js";

export type CreateBackgroundServicesOptions = ControllerLayerOptions & {
  messenger?: {
    compare?: CompareFn<unknown>;
  };
  engine?: EngineOptions;
  storage?: {
    port: StoragePort;
    now?: () => number;
    hydrate?: boolean;
    keyringStore: KeyringStorePort;
    logger?: (message: string, error?: unknown) => void;
  };
  store?: {
    ports: {
      approvals: ApprovalsPort;
      transactions: TransactionsPort;
    };
  };
  settings?: {
    port: SettingsPort;
  };
  session?: SessionOptions;
  rpcClients?: RpcLayerOptions;
};

const castMessenger = <Topics extends Record<string, unknown>>(messenger: ControllerMessenger<MessengerTopics>) =>
  messenger as unknown as ControllerMessenger<Topics>;

const createInMemoryKeyringStore = (): KeyringStorePort => {
  let keyrings: KeyringMeta[] = [];
  let accounts: AccountMeta[] = [];
  return {
    async getKeyringMetas() {
      return [...keyrings];
    },
    async getAccountMetas() {
      return [...accounts];
    },
    async putKeyringMetas(metas) {
      keyrings = metas.map((m) => ({ ...m }));
    },
    async putAccountMetas(metas) {
      accounts = metas.map((m) => ({ ...m }));
    },
    async deleteKeyringMeta(id) {
      keyrings = keyrings.filter((k) => k.id !== id);
      accounts = accounts.filter((a) => a.keyringId !== id);
    },
    async deleteAccount(address) {
      accounts = accounts.filter((a) => a.address !== address);
    },
    async deleteAccountsByKeyring(keyringId) {
      accounts = accounts.filter((a) => a.keyringId !== keyringId);
    },
  };
};
export const createBackgroundServices = (options?: CreateBackgroundServicesOptions) => {
  const {
    messenger: messengerOptions,
    network: networkOptions,
    accounts: accountOptions,
    approvals: approvalOptions,
    permissions: permissionOptions,
    transactions: transactionOptions,
    engine: engineOptions,
    storage: storageOptions,
    store: storeOptions,
    settings: settingsOptions,
    session: sessionOptions,
    chainRegistry: chainRegistryOptions,
    rpcClients: rpcClientOptions,
  } = options ?? {};

  const messenger = new ControllerMessenger<MessengerTopics>(
    messengerOptions?.compare === undefined ? {} : { compare: messengerOptions.compare },
  );
  const keyringStore = storageOptions?.keyringStore ?? createInMemoryKeyringStore();

  if (!chainRegistryOptions?.port) {
    throw new Error("createBackgroundServices requires chainRegistry.port");
  }
  const controllerOptions: ControllerLayerOptions = {
    ...(networkOptions ? { network: networkOptions } : {}),
    ...(accountOptions ? { accounts: accountOptions } : {}),
    ...(approvalOptions ? { approvals: approvalOptions } : {}),
    ...(permissionOptions ? { permissions: permissionOptions } : {}),
    ...(transactionOptions ? { transactions: transactionOptions } : {}),
    chainRegistry: chainRegistryOptions,
  };

  let namespaceResolverFn: (context?: RpcInvocationContext) => Namespace = () => EIP155_NAMESPACE;

  if (!storeOptions?.ports?.approvals) {
    throw new Error("createBackgroundServices requires store.ports.approvals");
  }
  if (!storeOptions?.ports?.transactions) {
    throw new Error("createBackgroundServices requires store.ports.transactions");
  }

  const approvalsService = createApprovalsService({
    port: storeOptions.ports.approvals,
    now: storageOptions?.now ?? Date.now,
  });

  const transactionsService = createTransactionsService({
    port: storeOptions.ports.transactions,
    now: storageOptions?.now ?? Date.now,
  });

  const controllersInit = initControllers({
    messenger,
    namespaceResolver: (ctx) => namespaceResolverFn(ctx),
    approvalsService,
    transactionsService,
    options: controllerOptions,
  });

  const { controllersBase, transactionRegistry, networkController, chainRegistryController, permissionController } =
    controllersInit;

  const rpcClientRegistry = initRpcLayer({
    controllers: controllersBase,
    ...(rpcClientOptions ? { rpcClientOptions } : {}),
  });

  const storagePort = storageOptions?.port;
  const storageNow = storageOptions?.now ?? Date.now;
  const attention = createAttentionService({
    messenger: castMessenger<AttentionServiceMessengerTopics>(messenger),
    now: storageNow,
  });

  const hydrationEnabled = storageOptions?.hydrate ?? true;
  const storageLogger =
    storageOptions?.logger ??
    ((message: string, error?: unknown) => {
      console.warn("[createBackgroundServices]", message, error);
    });

  const settingsPort = settingsOptions?.port;
  let cachedSettings: SettingsRecord | null = null;
  let settingsLoaded = false;
  // Serialize settings writes to avoid out-of-order completion clobbering newer values.
  let settingsWriteQueue: Promise<void> = Promise.resolve();

  const persistActiveChainRef = async (chainRef: ChainRef) => {
    if (!settingsPort) return;
    if (!settingsLoaded) return;
    if (cachedSettings?.activeChainRef === chainRef) return;

    settingsWriteQueue = settingsWriteQueue
      .catch(() => {})
      .then(async () => {
        let latest: SettingsRecord | null = null;
        try {
          latest = await settingsPort.get();
        } catch (error) {
          storageLogger("settings: failed to load before persist", error);
        }

        if (latest?.activeChainRef === chainRef) {
          cachedSettings = latest;
          return;
        }

        const selectedAccountId = latest?.selectedAccountId ?? cachedSettings?.selectedAccountId;
        const next: SettingsRecord = {
          id: "settings",
          activeChainRef: chainRef,
          ...(selectedAccountId ? { selectedAccountId } : {}),
          updatedAt: storageNow(),
        };

        try {
          await settingsPort.put(next);
          cachedSettings = next;
        } catch (error) {
          storageLogger("settings: failed to persist activeChainRef", error);
        }
      });

    await settingsWriteQueue;
  };
  let destroyed = false;
  let isHydrating = false;
  let pendingNetworkRegistrySync = false;
  let storageSyncAttached = false;
  let initializePromise: Promise<void> | null = null;
  let initialized = false;

  let hydratedNetworkRpc: Record<ChainRef, RpcEndpointState> | null = null;
  const sessionLayer = initSessionLayer({
    messenger,
    controllers: controllersBase,
    keyringStore,
    storageLogger,
    storageNow,
    hydrationEnabled,
    getIsHydrating: () => isHydrating,
    getIsDestroyed: () => destroyed,
    ...(storagePort ? { storagePort } : {}),
    ...(sessionOptions ? { sessionOptions } : {}),
  });

  const engine = initEngine(engineOptions);

  const keyringService = sessionLayer.keyringService;
  const eip155Signer = createEip155Signer({ keyring: keyringService });

  if (!transactionRegistry.get(EIP155_NAMESPACE)) {
    const broadcaster = createEip155Broadcaster({
      rpcClientFactory: (chainRef) => rpcClientRegistry.getClient("eip155", chainRef),
    });

    const adapter = createEip155TransactionAdapter({
      rpcClientFactory: (chainRef) => rpcClientRegistry.getClient("eip155", chainRef),
      signer: eip155Signer,
      broadcaster,
      chains: createDefaultChainModuleRegistry(),
    });
    transactionRegistry.register(EIP155_NAMESPACE, adapter);
  }

  const controllers: HandlerControllers = {
    ...controllersBase,
    signers: { eip155: eip155Signer },
  };

  namespaceResolverFn = createNamespaceResolver(controllers);

  const transactionsLifecycle = createTransactionsLifecycle({
    controller: controllers.transactions,
    service: transactionsService,
    unlock: sessionLayer.session.unlock,
    logger: storageLogger,
  });

  const accountsBridge = new AccountsKeyringBridge({
    keyring: keyringService,
    accounts: {
      addAccount: (params) => controllersBase.accounts.addAccount(params),
      removeAccount: (params) => controllersBase.accounts.removeAccount(params),
      switchActive: (params) => controllersBase.accounts.switchActive(params),
      getState: () => controllersBase.accounts.getState(),
      getActivePointer: () => controllersBase.accounts.getActivePointer(),
    },
    logger: storageLogger,
  });

  const syncAccountsPointer = async (chain: ChainMetadata) => {
    const pointer = controllersBase.accounts.getActivePointer();
    const available = controllersBase.accounts.getAccounts({ chainRef: chain.chainRef });
    const preferred =
      pointer?.namespace === chain.namespace && pointer.address && available.includes(pointer.address)
        ? pointer.address
        : null;

    try {
      await controllersBase.accounts.switchActive({ chainRef: chain.chainRef, address: preferred ?? null });
    } catch (error) {
      storageLogger(`accounts: failed to align pointer with active chain ${chain.chainRef}`, error);
    }
  };

  const unsubscribePointerSync = networkController.onChainChanged((chain) => {
    void syncAccountsPointer(chain);
    // During initialization, the network controller may emit a chain change while we're
    // still resolving the preferred chain from settings; don't overwrite persisted settings
    // with the controller's default.
    if (!initialized) return;
    void persistActiveChainRef(chain.chainRef);
  });

  void syncAccountsPointer(networkController.getActiveChain());

  const storageSync =
    storagePort === undefined
      ? undefined
      : createStorageSync({
          storage: storagePort,
          controllers: {
            network: networkController,
            accounts: {
              onStateChanged: (handler) => controllersBase.accounts.onStateChanged(handler),
            },
            permissions: {
              onPermissionsChanged: (handler) => permissionController.onPermissionsChanged(handler),
            },
          },
          now: storageNow,
          logger: storageLogger,
        });

  const readRegistryChains = (): ChainMetadata[] => chainRegistryController.getChains().map((entry) => entry.metadata);

  const selectActiveChainRef = (
    currentState: ReturnType<typeof networkController.getState>,
    registryChains: ChainMetadata[],
  ): ChainRef => {
    if (registryChains.length === 0) {
      return currentState.activeChain;
    }

    const available = new Set(registryChains.map((chain) => chain.chainRef));

    const preferred = cachedSettings?.activeChainRef ?? null;
    if (preferred && available.has(preferred)) {
      return preferred;
    }

    if (available.has(currentState.activeChain)) {
      return currentState.activeChain;
    }

    if (available.has(DEFAULT_CHAIN.chainRef)) {
      return DEFAULT_CHAIN.chainRef;
    }

    return registryChains[0]!.chainRef;
  };

  const synchronizeNetworkFromRegistry = async () => {
    const registryChains = readRegistryChains();
    if (registryChains.length === 0) {
      pendingNetworkRegistrySync = false;
      return;
    }

    const currentState = networkController.getState();
    const nextActive = selectActiveChainRef(currentState, registryChains);

    const rpc = Object.fromEntries(
      registryChains.map((chain) => {
        const fromHydrate = hydratedNetworkRpc?.[chain.chainRef];
        const fromCurrent = currentState.rpc[chain.chainRef];
        const next = fromHydrate ?? fromCurrent ?? buildDefaultEndpointState(chain);
        return [chain.chainRef, next] as const;
      }),
    ) as Record<ChainRef, RpcEndpointState>;

    hydratedNetworkRpc = null;

    networkController.replaceState({
      activeChain: nextActive,
      knownChains: registryChains,
      rpc,
    });

    await persistActiveChainRef(nextActive);

    pendingNetworkRegistrySync = false;
  };

  const requestNetworkRegistrySync = () => {
    if (isHydrating) {
      pendingNetworkRegistrySync = true;
      return;
    }
    void synchronizeNetworkFromRegistry();
  };

  const unsubscribeRegistry = chainRegistryController.onStateChanged(() => {
    requestNetworkRegistrySync();
  });

  const hydrateSnapshot = async <Namespace extends StorageNamespace>(
    namespace: Namespace,
    apply: (payload: StorageSnapshotMap[Namespace]["payload"]) => void,
  ) => {
    if (!storagePort) return;

    try {
      const snapshot = await storagePort.loadSnapshot(namespace);
      if (!snapshot) {
        return;
      }
      apply(snapshot.payload);
    } catch (error) {
      storageLogger(`storage: failed to hydrate ${namespace}`, error);
      try {
        await storagePort.clearSnapshot(namespace);
      } catch (clearError) {
        storageLogger(`storage: failed to clear snapshot ${namespace}`, clearError);
      }
    }
  };

  const hydrateControllers = async () => {
    if (!storagePort || !hydrationEnabled) {
      return;
    }

    try {
      const snapshot = await storagePort.loadSnapshot(StorageNamespaces.Network);
      if (snapshot) {
        const loadedVersion = snapshot.version;
        if (loadedVersion !== NETWORK_SNAPSHOT_VERSION) {
          await storagePort.clearSnapshot(StorageNamespaces.Network);
        } else {
          hydratedNetworkRpc = snapshot.payload.rpc;
        }
      }
    } catch (error) {
      storageLogger(`storage: failed to hydrate ${StorageNamespaces.Network}`, error);
      try {
        await storagePort.clearSnapshot(StorageNamespaces.Network);
      } catch (clearError) {
        storageLogger(`storage: failed to clear snapshot ${StorageNamespaces.Network}`, clearError);
      }
    }

    await hydrateSnapshot(StorageNamespaces.Accounts, (payload) => {
      controllers.accounts.replaceState(payload);
    });
    await hydrateSnapshot(StorageNamespaces.Permissions, (payload) => {
      controllers.permissions.replaceState(payload);
    });
  };

  const initialize = async () => {
    if (initialized || destroyed) {
      return;
    }

    if (initializePromise) {
      await initializePromise;
      return;
    }

    initializePromise = (async () => {
      await chainRegistryController.whenReady();

      try {
        await approvalsService.expireAllPending({ finalStatusReason: "session_lost" });
      } catch (error) {
        storageLogger("approvals: failed to expire pending on initialize", error);
      }

      await transactionsLifecycle.initialize();

      if (settingsPort) {
        try {
          cachedSettings = await settingsPort.get();
        } catch (error) {
          storageLogger("settings: failed to load", error);
          cachedSettings = null;
        }
        settingsLoaded = true;
      }

      isHydrating = true;
      pendingNetworkRegistrySync = true;
      try {
        await hydrateControllers();
        await sessionLayer.hydrateVaultMeta();
      } finally {
        isHydrating = false;
        if (pendingNetworkRegistrySync) {
          await synchronizeNetworkFromRegistry();
        }
        initialized = true;
      }
    })();

    try {
      await initializePromise;
    } finally {
      initializePromise = null;
    }
  };

  const start = () => {
    if (destroyed) {
      throw new Error("createBackgroundServices lifecycle cannot start after destroy()");
    }

    if (!initialized) {
      throw new Error("createBackgroundServices.lifecycle.initialize() must complete before start()");
    }

    if (storageSync && !storageSyncAttached) {
      storageSync.attach();
      storageSyncAttached = true;
    }

    sessionLayer.attachSessionListeners();
    transactionsLifecycle.start();
  };

  const destroy = () => {
    if (destroyed) {
      return;
    }

    destroyed = true;
    transactionsLifecycle.destroy();
    sessionLayer.cleanupVaultPersistTimer();
    sessionLayer.detachSessionListeners();
    sessionLayer.destroySessionLayer();
    try {
      unsubscribeRegistry();
    } catch (error) {
      storageLogger("lifecycle: failed to remove chain registry listener", error);
    }
    try {
      unsubscribePointerSync();
    } catch (error) {
      console.warn("[createBackgroundServices] failed to remove network pointer sync listener", error);
    }

    if (storageSyncAttached) {
      storageSync?.detach();
      storageSyncAttached = false;
    }

    rpcClientRegistry.destroy();
    engine.destroy();
    messenger.clear();
  };

  return {
    messenger,
    attention,
    engine,
    controllers,
    session: sessionLayer.session,
    rpcClients: rpcClientRegistry,
    getActiveNamespace: namespaceResolverFn,
    lifecycle: {
      initialize,
      start,
      destroy,
    },
    keyring: keyringService,
    accountsRuntime: accountsBridge,
  };
};
