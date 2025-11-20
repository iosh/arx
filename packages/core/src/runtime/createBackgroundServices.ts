import type { Caip2ChainId } from "../chains/ids.js";
import type { ChainMetadata } from "../chains/metadata.js";
import { type CompareFn, ControllerMessenger } from "../messenger/ControllerMessenger.js";
import { EIP155_NAMESPACE } from "../rpc/handlers/namespaces/utils.js";
import type { HandlerControllers, Namespace } from "../rpc/handlers/types.js";
import { createNamespaceResolver, type RpcInvocationContext } from "../rpc/index.js";
import type { StorageNamespace, StoragePort, StorageSnapshotMap } from "../storage/index.js";
import { StorageNamespaces } from "../storage/index.js";
import { createEip155TransactionAdapter } from "../transactions/adapters/eip155/adapter.js";
import { createEip155Broadcaster } from "../transactions/adapters/eip155/broadcaster.js";
import { createEip155Signer } from "../transactions/adapters/eip155/signer.js";
import { cloneTransactionState } from "../transactions/storage/state.js";
import { DEFAULT_CHAIN } from "./background/constants.js";
import { type ControllerLayerOptions, initControllers } from "./background/controllers.js";
import { type EngineOptions, initEngine } from "./background/engine.js";
import type { MessengerTopics } from "./background/messenger.js";
import { initRpcLayer, type RpcLayerOptions } from "./background/rpcLayer.js";
import type { BackgroundSessionServices } from "./background/session.js";
import { initSessionLayer, type SessionOptions } from "./background/session.js";
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
    logger?: (message: string, error?: unknown) => void;
  };
  session?: SessionOptions;
  rpcClients?: RpcLayerOptions;
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
    rpcClients: rpcClientOptions,
  } = options ?? {};

  const messenger = new ControllerMessenger<MessengerTopics>(
    messengerOptions?.compare === undefined ? {} : { compare: messengerOptions.compare },
  );

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

  const controllersInit = initControllers({
    messenger,
    namespaceResolver: (ctx) => namespaceResolverFn(ctx),
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
  const hydrationEnabled = storageOptions?.hydrate ?? true;
  const storageLogger =
    storageOptions?.logger ??
    ((message: string, error?: unknown) => {
      console.warn("[createBackgroundServices]", message, error);
    });

  let destroyed = false;
  let isHydrating = false;
  let pendingNetworkRegistrySync = false;
  let storageSyncAttached = false;
  let initializePromise: Promise<void> | null = null;
  let initialized = false;

  const sessionLayer = initSessionLayer({
    messenger,
    controllers: controllersBase,
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
      signer: eip155Signer,
      broadcaster,
      rpcClientFactory: (chainRef) => rpcClientRegistry.getClient("eip155", chainRef),
    });

    transactionRegistry.register(EIP155_NAMESPACE, adapter);
  }

  const controllers: HandlerControllers = {
    ...controllersBase,
    signers: { eip155: eip155Signer },
  };

  namespaceResolverFn = createNamespaceResolver(controllers);

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
            approvals: controllersBase.approvals,
            transactions: controllersBase.transactions,
          },
          now: storageNow,
          logger: storageLogger,
        });

  const readRegistryChains = (): ChainMetadata[] => chainRegistryController.getChains().map((entry) => entry.metadata);

  const selectActiveChainRef = (
    currentState: ReturnType<typeof networkController.getState>,
    registryChains: ChainMetadata[],
  ): Caip2ChainId => {
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
      controllers.transactions.replaceState(cloneTransactionState(payload));
    });
    await controllers.transactions.resumePending();
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
        await sessionLayer.hydrateVaultMeta();
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

    sessionLayer.attachSessionListeners();
  };

  const destroy = () => {
    if (destroyed) {
      return;
    }

    destroyed = true;
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
