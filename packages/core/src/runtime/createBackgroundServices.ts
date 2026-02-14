import type { ChainRef } from "../chains/ids.js";
import type { ChainMetadata } from "../chains/metadata.js";
import { createDefaultChainModuleRegistry } from "../chains/registry.js";
import type { RpcEndpointState } from "../controllers/network/types.js";
import type { SettingsRecord } from "../db/records.js";
import { type CompareFn, ControllerMessenger } from "../messenger/ControllerMessenger.js";
import { EIP155_NAMESPACE } from "../rpc/handlers/namespaces/utils.js";
import type { HandlerControllers, Namespace } from "../rpc/handlers/types.js";
import { createRpcRegistry, type RpcInvocationContext, registerBuiltinRpcAdapters } from "../rpc/index.js";
import type { Eip155RpcCapabilities, Eip155RpcClient } from "../rpc/namespaceClients/eip155.js";
import { createAccountsService } from "../services/accounts/AccountsService.js";
import type { AccountsPort } from "../services/accounts/port.js";
import { createApprovalsService } from "../services/approvals/ApprovalsService.js";
import type { ApprovalsPort } from "../services/approvals/port.js";
import { type AttentionServiceMessengerTopics, createAttentionService } from "../services/attention/index.js";
import { createKeyringMetasService } from "../services/keyringMetas/KeyringMetasService.js";
import type { KeyringMetasPort } from "../services/keyringMetas/port.js";
import { createPermissionsService } from "../services/permissions/PermissionsService.js";
import type { PermissionsPort } from "../services/permissions/port.js";
import type { SettingsPort } from "../services/settings/port.js";
import { createSettingsService } from "../services/settings/SettingsService.js";
import type { TransactionsPort } from "../services/transactions/port.js";
import { createTransactionsService } from "../services/transactions/TransactionsService.js";
import type { NetworkRpcPort, VaultMetaPort } from "../storage/index.js";
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
import { createNetworkRpcSync } from "./persistence/createNetworkRpcSync.js";

export type { BackgroundSessionServices } from "./background/session.js";

export type CreateBackgroundServicesOptions = Omit<ControllerLayerOptions, "chainRegistry"> & {
  messenger?: {
    compare?: CompareFn<unknown>;
  };
  engine?: EngineOptions;
  storage?: {
    networkRpcPort?: NetworkRpcPort;
    vaultMetaPort?: VaultMetaPort;
    now?: () => number;
    hydrate?: boolean;
    logger?: (message: string, error?: unknown) => void;
    networkRpcDebounceMs?: number;
  };
  store: {
    ports: {
      approvals: ApprovalsPort;
      transactions: TransactionsPort;
      accounts: AccountsPort;
      keyringMetas: KeyringMetasPort;
      permissions: PermissionsPort;
    };
  };
  chainRegistry: NonNullable<ControllerLayerOptions["chainRegistry"]>;
  settings?: {
    port: SettingsPort;
  };
  session?: SessionOptions;
  rpcClients?: RpcLayerOptions;
};

const castMessenger = <Topics extends Record<string, unknown>>(messenger: ControllerMessenger<MessengerTopics>) =>
  messenger as unknown as ControllerMessenger<Topics>;
export const createBackgroundServices = (options: CreateBackgroundServicesOptions) => {
  const rpcRegistry = createRpcRegistry();
  registerBuiltinRpcAdapters(rpcRegistry);

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
  } = options;

  const messenger = new ControllerMessenger<MessengerTopics>(
    messengerOptions?.compare === undefined ? {} : { compare: messengerOptions.compare },
  );

  const controllerOptions: ControllerLayerOptions = {
    ...(networkOptions ? { network: networkOptions } : {}),
    ...(accountOptions ? { accounts: accountOptions } : {}),
    ...(approvalOptions ? { approvals: approvalOptions } : {}),
    ...(permissionOptions ? { permissions: permissionOptions } : {}),
    ...(transactionOptions ? { transactions: transactionOptions } : {}),
    chainRegistry: chainRegistryOptions,
  };

  let namespaceResolverFn: (context?: RpcInvocationContext) => Namespace = () => EIP155_NAMESPACE;

  const storageNow = storageOptions?.now ?? Date.now;
  const hydrationEnabled = storageOptions?.hydrate ?? true;
  const storageLogger =
    storageOptions?.logger ??
    ((message: string, error?: unknown) => {
      console.warn("[createBackgroundServices]", message, error);
    });

  const settingsPort = settingsOptions?.port;
  const settingsService =
    settingsPort === undefined
      ? null
      : createSettingsService({
          port: settingsPort,
          defaults: { activeChainRef: DEFAULT_CHAIN.chainRef },
          now: storageNow,
        });
  let cachedSettings: SettingsRecord | null = null;

  const approvalsService = createApprovalsService({
    port: storeOptions.ports.approvals,
    now: storageNow,
  });

  const transactionsService = createTransactionsService({
    port: storeOptions.ports.transactions,
    now: storageNow,
  });

  const permissionsService = createPermissionsService({
    port: storeOptions.ports.permissions,
    now: storageNow,
  });

  const accountsStore = createAccountsService({ port: storeOptions.ports.accounts });
  const keyringMetas = createKeyringMetasService({ port: storeOptions.ports.keyringMetas });

  const controllersInit = initControllers({
    messenger,
    namespaceResolver: (ctx) => namespaceResolverFn(ctx),
    rpcRegistry,
    accountsService: accountsStore,
    settingsService,
    approvalsService,
    permissionsService,
    transactionsService,
    options: controllerOptions,
  });

  const { controllersBase, transactionRegistry, networkController, chainRegistryController } = controllersInit;

  const rpcClientRegistry = initRpcLayer({
    controllers: controllersBase,
    ...(rpcClientOptions ? { rpcClientOptions } : {}),
  });

  const networkRpcPort = storageOptions?.networkRpcPort;
  const vaultMetaPort = storageOptions?.vaultMetaPort;
  const attention = createAttentionService({
    messenger: castMessenger<AttentionServiceMessengerTopics>(messenger),
    now: storageNow,
  });

  let destroyed = false;
  let isHydrating = true;
  let pendingNetworkRegistrySync = false;
  let networkRpcSyncAttached = false;
  let initializePromise: Promise<void> | null = null;
  let initialized = false;

  let hydratedNetworkRpcPreferences: Map<
    ChainRef,
    { activeIndex: number; strategy: RpcEndpointState["strategy"] }
  > | null = null;
  const sessionLayer = initSessionLayer({
    messenger,
    controllers: controllersBase,
    accountsStore,
    keyringMetas,
    storageLogger,
    storageNow,
    hydrationEnabled,
    getIsHydrating: () => isHydrating,
    getIsDestroyed: () => destroyed,
    ...(vaultMetaPort ? { vaultMetaPort } : {}),
    ...(sessionOptions ? { sessionOptions } : {}),
  });

  const engine = initEngine(engineOptions);

  const keyringService = sessionLayer.keyringService;
  const eip155Signer = createEip155Signer({ keyring: keyringService });

  if (!transactionRegistry.get(EIP155_NAMESPACE)) {
    const rpcClientFactory = (chainRef: string) =>
      rpcClientRegistry.getClient<Eip155RpcCapabilities>("eip155", chainRef) as Eip155RpcClient;

    const broadcaster = createEip155Broadcaster({
      rpcClientFactory,
    });

    const adapter = createEip155TransactionAdapter({
      rpcClientFactory,
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

  namespaceResolverFn = rpcRegistry.createNamespaceResolver(controllers);

  const transactionsLifecycle = createTransactionsLifecycle({
    controller: controllers.transactions,
    service: transactionsService,
    unlock: sessionLayer.session.unlock,
    logger: storageLogger,
  });

  const accountsBridge = new AccountsKeyringBridge({
    keyring: keyringService,
    accounts: {
      switchActive: (params) => controllersBase.accounts.switchActive(params),
      getState: () => controllersBase.accounts.getState(),
      getActivePointer: () => controllersBase.accounts.getActivePointer(),
    },
    logger: storageLogger,
  });
  const unsubscribeActiveChainPersist = networkController.onChainChanged((chain) => {
    if (destroyed) return;
    if (!settingsService) return;
    if (isHydrating) return;
    void settingsService
      .upsert({ activeChainRef: chain.chainRef })
      .then((next) => {
        cachedSettings = next;
      })
      .catch((error) => {
        storageLogger("settings: failed to persist activeChainRef", error);
      });
  });

  const networkRpcSync =
    networkRpcPort === undefined
      ? undefined
      : createNetworkRpcSync({
          port: networkRpcPort,
          network: networkController,
          now: storageNow,
          logger: storageLogger,
          ...(storageOptions?.networkRpcDebounceMs !== undefined
            ? { debounceMs: storageOptions.networkRpcDebounceMs }
            : {}),
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
    const didChange = currentState.activeChain !== nextActive;

    const rpc = Object.fromEntries(
      registryChains.map((chain) => {
        const fromCurrent = currentState.rpc[chain.chainRef];
        const base = fromCurrent ?? buildDefaultEndpointState(chain);

        const pref = hydratedNetworkRpcPreferences?.get(chain.chainRef) ?? null;
        if (!pref) {
          return [chain.chainRef, base] as const;
        }

        // Apply the hydrated preference only once per chainRef so later registry syncs
        // don't keep overriding live controller state. Keep other keys for chains that
        // may appear later (e.g. wallet_addEthereumChain / delayed registry load).
        hydratedNetworkRpcPreferences?.delete(chain.chainRef);

        const safeIndex = Math.min(pref.activeIndex, Math.max(0, base.endpoints.length - 1));
        const next: RpcEndpointState = {
          ...base,
          activeIndex: safeIndex,
          strategy: pref.strategy,
        };

        return [chain.chainRef, next] as const;
      }),
    ) as Record<ChainRef, RpcEndpointState>;

    if (hydratedNetworkRpcPreferences?.size === 0) {
      hydratedNetworkRpcPreferences = null;
    }

    networkController.replaceState({
      activeChain: nextActive,
      knownChains: registryChains,
      rpc,
    });

    // Persist any corrections even when the active chain didn't change (e.g. stale settings fallback).
    if (!didChange && settingsService && !isHydrating && cachedSettings?.activeChainRef !== nextActive) {
      try {
        cachedSettings = await settingsService.upsert({ activeChainRef: nextActive });
      } catch (error) {
        storageLogger("settings: failed to persist corrected activeChainRef", error);
      }
    }

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

  const hydrateControllers = async () => {
    if (!networkRpcPort || !hydrationEnabled) {
      return;
    }

    try {
      const rows = await networkRpcPort.getAll();
      const next = new Map<ChainRef, { activeIndex: number; strategy: RpcEndpointState["strategy"] }>();
      for (const row of rows) {
        next.set(row.chainRef, { activeIndex: row.activeIndex, strategy: row.strategy });
      }
      hydratedNetworkRpcPreferences = next;
    } catch (error) {
      storageLogger("storage: failed to hydrate network rpc preferences", error);
    }

    // Permissions are store-backed (PR5 Step 4): no snapshot hydration.
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
      await controllersBase.permissions.whenReady();

      try {
        await approvalsService.expireAllPending({ finalStatusReason: "session_lost" });
      } catch (error) {
        storageLogger("approvals: failed to expire pending on initialize", error);
      }

      await transactionsLifecycle.initialize();

      if (settingsService) {
        try {
          cachedSettings = await settingsService.get();
        } catch (error) {
          storageLogger("settings: failed to load", error);
          cachedSettings = null;
        }
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

    if (networkRpcSync && !networkRpcSyncAttached) {
      networkRpcSync.attach();
      networkRpcSyncAttached = true;
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
      controllersBase.accounts.destroy?.();
    } catch (error) {
      storageLogger("lifecycle: failed to destroy accounts controller", error);
    }
    try {
      unsubscribeRegistry();
    } catch (error) {
      storageLogger("lifecycle: failed to remove chain registry listener", error);
    }
    try {
      unsubscribeActiveChainPersist();
    } catch (error) {
      console.warn("[createBackgroundServices] failed to remove activeChain persist listener", error);
    }

    if (networkRpcSyncAttached) {
      networkRpcSync?.detach();
      networkRpcSyncAttached = false;
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
    rpcRegistry,
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
