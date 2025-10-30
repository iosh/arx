import { JsonRpcEngine, type JsonRpcMiddleware } from "@metamask/json-rpc-engine";
import type { Json, JsonRpcParams } from "@metamask/utils";
import { DEFAULT_CHAIN_METADATA } from "../chains/chains.seed.js";
import type { Caip2ChainId } from "../chains/ids.js";
import type { ChainMetadata } from "../chains/metadata.js";
import type { ChainRegistryPort } from "../chains/registryPort.js";
import { InMemoryMultiNamespaceAccountsController } from "../controllers/account/MultiNamespaceAccountsController.js";
import type {
  AccountController,
  AccountMessenger,
  AccountMessengerTopics,
  MultiNamespaceAccountsState,
} from "../controllers/account/types.js";
import { InMemoryApprovalController } from "../controllers/approval/ApprovalController.js";
import type {
  ApprovalController,
  ApprovalMessenger,
  ApprovalMessengerTopics,
  ApprovalState,
} from "../controllers/approval/types.js";
import { InMemoryChainRegistryController } from "../controllers/chainRegistry/ChainRegistryController.js";
import type {
  ChainRegistryController,
  ChainRegistryMessenger,
  ChainRegistryMessengerTopics,
} from "../controllers/chainRegistry/types.js";
import { InMemoryNetworkController } from "../controllers/network/NetworkController.js";
import type {
  NetworkController,
  NetworkMessenger,
  NetworkMessengerTopic,
  NetworkState,
  RpcEndpointState,
  RpcEventLogger,
  RpcStrategyConfig,
} from "../controllers/network/types.js";
import { InMemoryPermissionController } from "../controllers/permission/PermissionController.js";
import type {
  PermissionController,
  PermissionMessenger,
  PermissionMessengerTopics,
  PermissionScopeResolver,
  PermissionsState,
} from "../controllers/permission/types.js";
import { InMemoryTransactionController } from "../controllers/transaction/TransactionController.js";
import type {
  TransactionController,
  TransactionMessenger,
  TransactionMessengerTopics,
  TransactionState,
} from "../controllers/transaction/types.js";
import type { UnlockController, UnlockControllerOptions, UnlockMessengerTopics } from "../controllers/unlock/types.js";
import { InMemoryUnlockController } from "../controllers/unlock/UnlockController.js";
import { EthereumHdKeyring } from "../keyring/index.js";
import { type CompareFn, ControllerMessenger } from "../messenger/ControllerMessenger.js";
import { EIP155_NAMESPACE } from "../rpc/handlers/namespaces/utils.js";
import type { HandlerControllers, Namespace } from "../rpc/handlers/types.js";
import { createNamespaceResolver, createPermissionScopeResolver, type RpcInvocationContext } from "../rpc/index.js";
import type { StorageNamespace, StoragePort, StorageSnapshotMap, VaultMetaSnapshot } from "../storage/index.js";
import { StorageNamespaces, VAULT_META_SNAPSHOT_VERSION } from "../storage/index.js";
import { TransactionAdapterRegistry } from "../transactions/adapters/registry.js";
import type { VaultCiphertext, VaultService } from "../vault/types.js";
import { createVaultService } from "../vault/vaultService.js";
import { AccountsKeyringBridge } from "./keyring/AccountsKeyringBridge.js";
import { KeyringService } from "./keyring/KeyringService.js";
import { createStorageSync } from "./persistence/createStorageSync.js";

type MessengerTopics = AccountMessengerTopics &
  ApprovalMessengerTopics &
  NetworkMessengerTopic &
  PermissionMessengerTopics &
  TransactionMessengerTopics &
  UnlockMessengerTopics &
  ChainRegistryMessengerTopics;

const DEFAULT_CHAIN_SEED = DEFAULT_CHAIN_METADATA[0];
if (!DEFAULT_CHAIN_SEED) {
  throw new Error("DEFAULT_CHAIN_METADATA must include at least one chain definition");
}
const DEFAULT_CHAIN: ChainMetadata = DEFAULT_CHAIN_SEED;
const DEFAULT_STRATEGY: RpcStrategyConfig = { id: "round-robin" };

const cloneHeaders = (headers?: Record<string, string>) => {
  if (!headers) return undefined;
  return Object.fromEntries(Object.entries(headers));
};

const buildDefaultEndpointState = (metadata: ChainMetadata, strategy?: RpcStrategyConfig): RpcEndpointState => {
  const endpoints = metadata.rpcEndpoints.map((endpoint, index) => ({
    index,
    url: endpoint.url,
    type: endpoint.type,
    weight: endpoint.weight,
    headers: cloneHeaders(endpoint.headers),
  }));

  if (endpoints.length === 0) {
    throw new Error(`Chain ${metadata.chainRef} must declare at least one RPC endpoint`);
  }

  const health = endpoints.map((endpoint) => ({
    index: endpoint.index,
    successCount: 0,
    failureCount: 0,
    consecutiveFailures: 0,
  }));

  return {
    activeIndex: 0,
    endpoints,
    health,
    strategy: strategy
      ? { id: strategy.id, options: strategy.options ? { ...strategy.options } : undefined }
      : { ...DEFAULT_STRATEGY },
    lastUpdatedAt: 0,
  };
};

const DEFAULT_NETWORK_STATE: NetworkState = {
  activeChain: DEFAULT_CHAIN.chainRef,
  knownChains: [DEFAULT_CHAIN],
  rpc: {
    [DEFAULT_CHAIN.chainRef]: buildDefaultEndpointState(DEFAULT_CHAIN),
  },
};

const DEFAULT_ACCOUNTS_STATE: MultiNamespaceAccountsState = {
  namespaces: {
    eip155: { all: [], primary: null },
  },
  active: {
    namespace: "eip155",
    chainRef: DEFAULT_CHAIN.chainRef,
    address: null,
  },
};

const DEFAULT_PERMISSIONS_STATE: PermissionsState = {
  origins: {},
};

const DEFAULT_AUTO_LOCK_MS = 15 * 60 * 1000;
const DEFAULT_PERSIST_DEBOUNCE_MS = 250;

type VaultFactory = () => VaultService;
type UnlockFactory = (options: UnlockControllerOptions) => UnlockController;

type SessionOptions = {
  vault?: VaultService | VaultFactory;
  unlock?: UnlockFactory;
  autoLockDuration?: number;
  persistDebounceMs?: number;
  timers?: UnlockControllerOptions["timers"];
};

export type BackgroundSessionServices = {
  vault: VaultService;
  unlock: UnlockController;
  getVaultMetaState(): VaultMetaSnapshot["payload"];
  getLastPersistedVaultMeta(): VaultMetaSnapshot | null;
  persistVaultMeta(): Promise<void>;
};

export type CreateBackgroundServicesOptions = {
  messenger?: {
    compare?: CompareFn<unknown>;
  };
  network?: {
    initialState?: NetworkState;
    defaultStrategy?: RpcStrategyConfig;
    defaultCooldownMs?: number;
    now?: () => number;
    logger?: RpcEventLogger;
  };
  accounts?: {
    initialState?: MultiNamespaceAccountsState;
  };
  approvals?: {
    autoRejectMessage?: string;
    initialState?: ApprovalState;
  };
  permissions?: {
    initialState?: PermissionsState;
    scopeResolver?: PermissionScopeResolver;
  };
  transactions?: {
    autoApprove?: boolean;
    autoRejectMessage?: string;
    initialState?: TransactionState;
    registry?: TransactionAdapterRegistry;
  };
  engine?: {
    middlewares?: JsonRpcMiddleware<JsonRpcParams, Json>[];
  };
  storage?: {
    port: StoragePort;
    now?: () => number;
    hydrate?: boolean;
    logger?: (message: string, error: unknown) => void;
  };
  session?: SessionOptions;
  chainRegistry?: {
    port: ChainRegistryPort;
    seed?: ChainMetadata[];
    now?: () => number;
    logger?: (message: string, error?: unknown) => void;
    schemaVersion?: number;
  };
};

const castMessenger = <Topics extends Record<string, unknown>>(messenger: ControllerMessenger<MessengerTopics>) =>
  messenger as unknown as ControllerMessenger<Topics>;

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
    session: sessionOptions,
    chainRegistry: chainRegistryOptions,
  } = options ?? {};

  const messenger = new ControllerMessenger<MessengerTopics>(
    messengerOptions?.compare === undefined ? {} : { compare: messengerOptions.compare },
  );

  const networkController = new InMemoryNetworkController({
    messenger: castMessenger<NetworkMessengerTopic>(messenger) as NetworkMessenger,
    initialState: networkOptions?.initialState ?? DEFAULT_NETWORK_STATE,
    defaultStrategy: networkOptions?.defaultStrategy ?? DEFAULT_STRATEGY,
    ...(networkOptions?.defaultCooldownMs !== undefined ? { defaultCooldownMs: networkOptions.defaultCooldownMs } : {}),
    ...(networkOptions?.now ? { now: networkOptions.now } : {}),
    ...(networkOptions?.logger ? { logger: networkOptions.logger } : {}),
  });

  let namespaceResolverFn: (context?: RpcInvocationContext) => Namespace = () => EIP155_NAMESPACE;

  const permissionScopeResolver =
    permissionOptions?.scopeResolver ?? createPermissionScopeResolver((ctx) => namespaceResolverFn(ctx));

  const accountController = new InMemoryMultiNamespaceAccountsController({
    messenger: castMessenger<AccountMessengerTopics>(messenger) as AccountMessenger,
    initialState: accountOptions?.initialState ?? DEFAULT_ACCOUNTS_STATE,
  });

  const approvalController = new InMemoryApprovalController({
    messenger: castMessenger<ApprovalMessengerTopics>(messenger) as ApprovalMessenger,
    ...(approvalOptions?.autoRejectMessage !== undefined
      ? { autoRejectMessage: approvalOptions.autoRejectMessage }
      : {}),
    ...(approvalOptions?.initialState !== undefined ? { initialState: approvalOptions.initialState } : {}),
  });

  const permissionController = new InMemoryPermissionController({
    messenger: castMessenger<PermissionMessengerTopics>(messenger) as PermissionMessenger,
    initialState: permissionOptions?.initialState ?? DEFAULT_PERMISSIONS_STATE,
    scopeResolver: permissionScopeResolver,
  });

  const transactionController = new InMemoryTransactionController({
    messenger: castMessenger<TransactionMessengerTopics>(messenger) as TransactionMessenger,
    network: {
      getActiveChain: () => networkController.getActiveChain(),
    },
    accounts: {
      getActivePointer: () => accountController.getActivePointer(),
    },
    approvals: {
      requestApproval: (...args) => approvalController.requestApproval(...args),
    },
    registry: transactionOptions?.registry ?? new TransactionAdapterRegistry(),
    ...(transactionOptions?.autoApprove !== undefined ? { autoApprove: transactionOptions.autoApprove } : {}),
    ...(transactionOptions?.autoRejectMessage !== undefined
      ? { autoRejectMessage: transactionOptions.autoRejectMessage }
      : {}),
    ...(transactionOptions?.initialState !== undefined ? { initialState: transactionOptions.initialState } : {}),
  });

  if (!chainRegistryOptions?.port) {
    throw new Error("createBackgroundServices requires chainRegistry.port");
  }

  const seedSource = chainRegistryOptions.seed ?? DEFAULT_CHAIN_METADATA;
  const registrySeed: ChainMetadata[] = seedSource.map((entry) => ({ ...entry }));

  const chainRegistryController = new InMemoryChainRegistryController({
    messenger: castMessenger<ChainRegistryMessengerTopics>(messenger) as ChainRegistryMessenger,
    port: chainRegistryOptions.port,
    seed: registrySeed,
    ...(chainRegistryOptions.now ? { now: chainRegistryOptions.now } : {}),
    ...(chainRegistryOptions.logger ? { logger: chainRegistryOptions.logger } : {}),
    ...(chainRegistryOptions.schemaVersion !== undefined ? { schemaVersion: chainRegistryOptions.schemaVersion } : {}),
  });

  const engine = new JsonRpcEngine();
  const middlewares = engineOptions?.middlewares ?? [];

  if (middlewares.length > 0) {
    middlewares.forEach((middleware) => {
      engine.push(middleware);
    });
  }

  const controllers: {
    network: NetworkController;
    accounts: AccountController;
    approvals: ApprovalController;
    permissions: PermissionController;
    transactions: TransactionController;
    chainRegistry: ChainRegistryController;
  } = {
    network: networkController,
    accounts: accountController,
    approvals: approvalController,
    permissions: permissionController,
    transactions: transactionController,
    chainRegistry: chainRegistryController,
  };

  namespaceResolverFn = createNamespaceResolver(controllers);

  const syncAccountsPointer = async (chain: ChainMetadata) => {
    const pointer = accountController.getActivePointer();
    const available = accountController.getAccounts({ chainRef: chain.chainRef });
    const preferred =
      pointer?.namespace === chain.namespace && pointer.address && available.includes(pointer.address)
        ? pointer.address
        : null;

    try {
      await accountController.switchActive({ chainRef: chain.chainRef, address: preferred ?? null });
    } catch (error) {
      console.warn(
        "[createBackgroundServices] failed to align accounts pointer with active chain",
        chain.chainRef,
        error,
      );
    }
  };

  const unsubscribePointerSync = networkController.onChainChanged((chain) => {
    void syncAccountsPointer(chain);
  });

  void syncAccountsPointer(networkController.getActiveChain());

  const storagePort = storageOptions?.port;
  const storageNow = storageOptions?.now ?? Date.now;
  const hydrationEnabled = storageOptions?.hydrate ?? true;
  const storageLogger =
    storageOptions?.logger ??
    ((message: string, error: unknown) => {
      console.warn("[createBackgroundServices]", message, error);
    });

  const storageSync =
    storagePort === undefined
      ? undefined
      : createStorageSync({
          storage: storagePort,
          controllers: {
            network: networkController,
            accounts: {
              onStateChanged: (handler) => accountController.onStateChanged(handler),
            },
            permissions: {
              onPermissionsChanged: (handler) => permissionController.onPermissionsChanged(handler),
            },
            approvals: approvalController,
            transactions: transactionController,
          },
          now: storageNow,
          logger: storageLogger,
        });

  let isHydrating = false;
  let pendingNetworkRegistrySync = false;

  const readRegistryChains = (): ChainMetadata[] => chainRegistryController.getChains().map((entry) => entry.metadata);

  const selectActiveChainRef = (currentState: NetworkState, registryChains: ChainMetadata[]): Caip2ChainId => {
    if (registryChains.length === 0) {
      return currentState.activeChain;
    }

    const available = new Set(registryChains.map((chain) => chain.chainRef));
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
    const existingRefs = new Set(currentState.knownChains.map((chain) => chain.chainRef));
    const registryRefs = new Set(registryChains.map((chain) => chain.chainRef));

    for (const chain of registryChains) {
      if (existingRefs.has(chain.chainRef)) {
        await networkController.syncChain(chain);
      } else {
        await networkController.addChain(chain);
      }
    }

    for (const chainRef of existingRefs) {
      if (!registryRefs.has(chainRef)) {
        await networkController.removeChain(chainRef);
      }
    }

    const latestState = networkController.getState();
    const nextActive = selectActiveChainRef(latestState, registryChains);
    await networkController.switchChain(nextActive);

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

  const resolveVault = (): VaultService => {
    const candidate = sessionOptions?.vault;
    if (!candidate) {
      return createVaultService();
    }
    return typeof candidate === "function" ? (candidate as VaultFactory)() : candidate;
  };

  const baseVault = resolveVault();
  const unlockFactory =
    sessionOptions?.unlock ?? ((unlockOptions: UnlockControllerOptions) => new InMemoryUnlockController(unlockOptions));

  const sessionTimers = sessionOptions?.timers ?? {};
  const sessionSetTimeout = sessionTimers.setTimeout ?? setTimeout;
  const sessionClearTimeout = sessionTimers.clearTimeout ?? clearTimeout;
  const baseAutoLockDuration = sessionOptions?.autoLockDuration ?? DEFAULT_AUTO_LOCK_MS;
  const persistDebounceMs = sessionOptions?.persistDebounceMs ?? DEFAULT_PERSIST_DEBOUNCE_MS;

  let vaultInitializedAt: number | null = null;
  let lastPersistedVaultMeta: VaultMetaSnapshot | null = null;
  let persistTimer: ReturnType<typeof setTimeout> | null = null;
  let destroyed = false;
  let storageSyncAttached = false;
  let sessionListenersAttached = false;
  let initializePromise: Promise<void> | null = null;
  let initialized = false;

  const ensureInitializedTimestamp = () => {
    if (vaultInitializedAt === null) {
      vaultInitializedAt = storageNow();
    }
    return vaultInitializedAt;
  };

  const updateInitializedAtFromCiphertext = (ciphertext: VaultCiphertext | null | undefined) => {
    if (!ciphertext) {
      return;
    }
    vaultInitializedAt = ciphertext.createdAt;
  };

  const vaultProxy: VaultService = {
    async initialize(params) {
      const ciphertext = await baseVault.initialize(params);
      updateInitializedAtFromCiphertext(ciphertext);
      if (!isHydrating) {
        await persistVaultMetaImmediate();
      }
      return ciphertext;
    },
    async unlock(params) {
      const secret = await baseVault.unlock(params);
      if (params.ciphertext) {
        updateInitializedAtFromCiphertext(params.ciphertext);
      } else {
        updateInitializedAtFromCiphertext(baseVault.getCiphertext());
      }
      return secret;
    },
    lock() {
      baseVault.lock();
      scheduleVaultMetaPersist();
    },
    exportKey() {
      return baseVault.exportKey();
    },
    async seal(params) {
      const ciphertext = await baseVault.seal(params);
      updateInitializedAtFromCiphertext(ciphertext);
      if (!isHydrating) {
        await persistVaultMetaImmediate();
      }
      return ciphertext;
    },
    importCiphertext(value) {
      baseVault.importCiphertext(value);
      updateInitializedAtFromCiphertext(value);
      scheduleVaultMetaPersist();
    },
    getCiphertext() {
      return baseVault.getCiphertext();
    },
    getStatus() {
      return baseVault.getStatus();
    },
    isUnlocked() {
      return baseVault.isUnlocked();
    },
  };
  const unlockOptions: UnlockControllerOptions = {
    messenger: castMessenger<UnlockMessengerTopics>(messenger),
    vault: {
      unlock: vaultProxy.unlock.bind(vaultProxy),
      lock: vaultProxy.lock.bind(vaultProxy),
      isUnlocked: vaultProxy.isUnlocked.bind(vaultProxy),
    },
    autoLockDuration: baseAutoLockDuration,
    now: storageNow,
  };

  if (sessionOptions?.timers) {
    unlockOptions.timers = sessionOptions.timers;
  }

  const unlock = unlockFactory(unlockOptions);

  const keyringService = new KeyringService({
    vault: vaultProxy,
    unlock,
    accounts: accountController,
    namespaces: {
      [EIP155_NAMESPACE]: {
        createKeyring: () => new EthereumHdKeyring(),
      },
    },
    logger: storageLogger,
  });

  keyringService.attach();

  const accountsBridge = new AccountsKeyringBridge({
    keyring: keyringService,
    accounts: {
      addAccount: (params) => accountController.addAccount(params),
      removeAccount: (params) => accountController.removeAccount(params),
      switchActive: (params) => accountController.switchActive(params),
      getState: () => accountController.getState(),
      getActivePointer: () => accountController.getActivePointer(),
    },
    logger: storageLogger,
  });

  const sessionSubscriptions: Array<() => void> = [];

  sessionSubscriptions.push(
    keyringService.onEnvelopeUpdated(() => {
      scheduleVaultMetaPersist();
    }),
  );

  const cleanupVaultPersistTimer = () => {
    if (persistTimer !== null) {
      sessionClearTimeout(persistTimer as Parameters<typeof clearTimeout>[0]);
      persistTimer = null;
    }
  };

  const persistVaultMetaImmediate = async (): Promise<void> => {
    if (!storagePort || destroyed) {
      return;
    }

    const ciphertext = vaultProxy.getCiphertext();
    if (ciphertext) {
      updateInitializedAtFromCiphertext(ciphertext);
    }

    const unlockState = unlock.getState();

    const envelope: VaultMetaSnapshot = {
      version: VAULT_META_SNAPSHOT_VERSION,
      updatedAt: storageNow(),
      payload: {
        ciphertext,
        autoLockDuration: unlockState.timeoutMs,
        initializedAt: ensureInitializedTimestamp(),
        unlockState: {
          isUnlocked: unlockState.isUnlocked,
          lastUnlockedAt: unlockState.lastUnlockedAt,
          nextAutoLockAt: unlockState.nextAutoLockAt,
        },
      },
    };

    try {
      await storagePort.saveVaultMeta(envelope);
      lastPersistedVaultMeta = envelope;
    } catch (error) {
      storageLogger("session: failed to persist vault meta", error);
    }
  };

  const scheduleVaultMetaPersist = () => {
    if (!storagePort || destroyed || isHydrating) {
      return;
    }

    if (persistDebounceMs <= 0) {
      void persistVaultMetaImmediate();
      return;
    }

    cleanupVaultPersistTimer();
    persistTimer = sessionSetTimeout(() => {
      persistTimer = null;
      void persistVaultMetaImmediate();
    }, persistDebounceMs);
  };

  const attachSessionListeners = () => {
    if (sessionListenersAttached) {
      return;
    }

    sessionListenersAttached = true;
    sessionSubscriptions.push(
      unlock.onStateChanged(() => {
        scheduleVaultMetaPersist();
      }),
    );
    sessionSubscriptions.push(
      unlock.onLocked(() => {
        scheduleVaultMetaPersist();
      }),
    );
    sessionSubscriptions.push(
      unlock.onUnlocked(() => {
        scheduleVaultMetaPersist();
      }),
    );
  };

  const detachSessionListeners = () => {
    if (!sessionListenersAttached) {
      return;
    }

    sessionListenersAttached = false;

    sessionSubscriptions.splice(0).forEach((unsubscribe) => {
      try {
        unsubscribe();
      } catch (error) {
        storageLogger("session: failed to remove unlock listener", error);
      }
    });
  };

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

    await hydrateSnapshot(StorageNamespaces.Network, (payload) => {
      controllers.network.replaceState(payload);
    });
    await hydrateSnapshot(StorageNamespaces.Accounts, (payload) => {
      controllers.accounts.replaceState(payload);
    });
    await hydrateSnapshot(StorageNamespaces.Permissions, (payload) => {
      controllers.permissions.replaceState(payload);
    });
    await hydrateSnapshot(StorageNamespaces.Approvals, (payload) => {
      controllers.approvals.replaceState(payload);
    });
    await hydrateSnapshot(StorageNamespaces.Transactions, (payload) => {
      controllers.transactions.replaceState(payload as unknown as TransactionState);
    });
  };

  const hydrateVaultMeta = async () => {
    if (!storagePort || !hydrationEnabled) {
      return;
    }

    try {
      const meta = await storagePort.loadVaultMeta();
      if (!meta) {
        vaultInitializedAt = null;
        lastPersistedVaultMeta = null;
        unlock.setAutoLockDuration(baseAutoLockDuration);
        return;
      }

      lastPersistedVaultMeta = meta;
      vaultInitializedAt = meta.payload.initializedAt;
      unlock.setAutoLockDuration(meta.payload.autoLockDuration);

      if (meta.payload.ciphertext) {
        try {
          vaultProxy.importCiphertext(meta.payload.ciphertext);
        } catch (error) {
          storageLogger("session: failed to import vault ciphertext", error);
          try {
            await storagePort.clearVaultMeta();
          } catch (clearError) {
            storageLogger("session: failed to clear vault meta", clearError);
          }
          vaultInitializedAt = null;
          lastPersistedVaultMeta = null;
          unlock.setAutoLockDuration(baseAutoLockDuration);
        }
      }
    } catch (error) {
      storageLogger("session: failed to hydrate vault meta", error);
    }
  };

  const getVaultMetaState = (): VaultMetaSnapshot["payload"] => {
    const unlockState = unlock.getState();

    return {
      ciphertext: vaultProxy.getCiphertext(),
      autoLockDuration: unlockState.timeoutMs,
      initializedAt: ensureInitializedTimestamp(),
      unlockState: {
        isUnlocked: unlockState.isUnlocked,
        lastUnlockedAt: unlockState.lastUnlockedAt,
        nextAutoLockAt: unlockState.nextAutoLockAt,
      },
    };
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

      if (!storagePort || !hydrationEnabled) {
        await synchronizeNetworkFromRegistry();
        initialized = true;
        return;
      }

      isHydrating = true;
      pendingNetworkRegistrySync = true;
      try {
        await hydrateControllers();
        await hydrateVaultMeta();
        initialized = true;
      } finally {
        isHydrating = false;
        if (pendingNetworkRegistrySync) {
          await synchronizeNetworkFromRegistry();
        }
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

    attachSessionListeners();
  };

  const destroy = () => {
    if (destroyed) {
      return;
    }

    destroyed = true;
    keyringService.detach();
    cleanupVaultPersistTimer();
    detachSessionListeners();
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

    engine.destroy();
    messenger.clear();
  };

  return {
    messenger,
    engine,
    controllers,
    session: {
      vault: vaultProxy,
      unlock,
      getVaultMetaState,
      getLastPersistedVaultMeta: () => lastPersistedVaultMeta,
      persistVaultMeta: () => persistVaultMetaImmediate(),
    } satisfies BackgroundSessionServices,
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

export type CreateBackgroundServicesResult = ReturnType<typeof createBackgroundServices>;
