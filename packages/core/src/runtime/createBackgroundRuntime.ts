import { createApprovalExecutor, createApprovalFlowRegistry } from "../approvals/index.js";
import { createDefaultChainAddressCodecRegistry } from "../chains/registry.js";
import { buildNetworkRuntimeInput } from "../controllers/network/config.js";
import { Messenger, type ViolationMode } from "../messenger/Messenger.js";
import { EIP155_NAMESPACE } from "../rpc/handlers/namespaces/utils.js";
import type { HandlerControllers, Namespace } from "../rpc/handlers/types.js";
import { createRpcRegistry, type RpcInvocationContext, registerBuiltinRpcAdapters } from "../rpc/index.js";
import { ATTENTION_TOPICS, createAttentionService } from "../services/runtime/attention/index.js";
import { createChainViewsService } from "../services/runtime/chainViews/index.js";
import { createAccountsService } from "../services/store/accounts/AccountsService.js";
import type { AccountsPort } from "../services/store/accounts/port.js";
import { createKeyringMetasService } from "../services/store/keyringMetas/KeyringMetasService.js";
import type { KeyringMetasPort } from "../services/store/keyringMetas/port.js";
import { createNetworkPreferencesService } from "../services/store/networkPreferences/NetworkPreferencesService.js";
import type { NetworkPreferencesPort } from "../services/store/networkPreferences/port.js";
import { createPermissionsService } from "../services/store/permissions/PermissionsService.js";
import type { PermissionsPort } from "../services/store/permissions/port.js";
import type { SettingsPort } from "../services/store/settings/port.js";
import { createSettingsService } from "../services/store/settings/SettingsService.js";
import type { TransactionsPort } from "../services/store/transactions/port.js";
import { createTransactionsService } from "../services/store/transactions/TransactionsService.js";
import type { VaultMetaPort } from "../storage/index.js";
import { DEFAULT_CHAIN } from "./background/constants.js";
import { type ControllerLayerOptions, initControllers } from "./background/controllers.js";
import { type EngineOptions, initEngine } from "./background/engine.js";
import { createNetworkBootstrap } from "./background/networkBootstrap.js";
import { registerDefaultTransactionAdapters } from "./background/registerDefaultTransactionAdapters.js";
import { type BackgroundRpcEnvHooks, createRpcEngineForBackground } from "./background/rpcEngineAssembly.js";
import { initRpcLayer, type RpcLayerOptions } from "./background/rpcLayer.js";
import { createRuntimeLifecycle } from "./background/runtimeLifecycle.js";
import { type RuntimePlugin, runPluginHooks, startPlugins } from "./background/runtimePlugins.js";
import { type BackgroundSessionServices, initSessionLayer, type SessionOptions } from "./background/session.js";
import { createTransactionsLifecycle } from "./background/transactionsLifecycle.js";
import type { KeyringService } from "./keyring/KeyringService.js";

export type { BackgroundSessionServices } from "./background/session.js";

export type CreateBackgroundRuntimeOptions = Omit<ControllerLayerOptions, "chainDefinitions"> & {
  messenger?: {
    violationMode?: ViolationMode;
  };
  engine?: EngineOptions;
  rpcEngine: {
    env: BackgroundRpcEnvHooks;
    assemble?: boolean;
  };
  networkPreferences: {
    port: NetworkPreferencesPort;
  };
  storage?: {
    vaultMetaPort?: VaultMetaPort;
    now?: () => number;
    hydrate?: boolean;
    logger?: (message: string, error?: unknown) => void;
  };
  store: {
    ports: {
      transactions: TransactionsPort;
      accounts: AccountsPort;
      keyringMetas: KeyringMetasPort;
      permissions: PermissionsPort;
    };
  };
  chainDefinitions: NonNullable<ControllerLayerOptions["chainDefinitions"]>;
  settings: {
    port: SettingsPort;
  };
  session?: SessionOptions;
  rpcClients?: RpcLayerOptions;
};

export type BackgroundRuntime = {
  bus: Messenger;
  controllers: HandlerControllers;
  services: {
    attention: ReturnType<typeof createAttentionService>;
    chainViews: ReturnType<typeof createChainViewsService>;
    session: BackgroundSessionServices;
    keyring: KeyringService;
  };
  rpc: {
    engine: ReturnType<typeof initEngine>;
    registry: ReturnType<typeof createRpcRegistry>;
    clients: ReturnType<typeof initRpcLayer>;
    getActiveNamespace: (context?: RpcInvocationContext) => Namespace;
  };
  lifecycle: {
    initialize: () => Promise<void>;
    start: () => void;
    destroy: () => void;
    getIsInitialized: () => boolean;
  };
};

export const createBackgroundRuntime = (options: CreateBackgroundRuntimeOptions): BackgroundRuntime => {
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
    rpcEngine: rpcEngineOptions,
    networkPreferences: networkPreferencesOptions,
    storage: storageOptions,
    store: storeOptions,
    settings: settingsOptions,
    session: sessionOptions,
    chainDefinitions: chainDefinitionsOptions,
    rpcClients: rpcClientOptions,
  } = options;

  const storageLogger = storageOptions?.logger ?? (() => {});
  const bus = new Messenger({
    violationMode: messengerOptions?.violationMode ?? "throw",
    onListenerError: ({ topic, error }) => storageLogger(`messenger: listener error in "${topic}"`, error),
    onViolation: (info) => storageLogger(`messenger: violation(${info.kind}) "${info.topic}"`, info),
  });
  const chainAddressCodecs = createDefaultChainAddressCodecRegistry();

  let namespaceResolverFn: (context?: RpcInvocationContext) => Namespace = () => EIP155_NAMESPACE;
  const storageNow = storageOptions?.now ?? Date.now;
  const hydrationEnabled = storageOptions?.hydrate ?? true;

  const controllerOptions: ControllerLayerOptions = {
    ...(networkOptions ? { network: networkOptions } : {}),
    ...(accountOptions ? { accounts: accountOptions } : {}),
    ...(approvalOptions ? { approvals: { ...approvalOptions, logger: approvalOptions.logger ?? storageLogger } } : {}),
    ...(permissionOptions
      ? { permissions: { ...permissionOptions, chains: chainAddressCodecs } }
      : { permissions: { chains: chainAddressCodecs } }),
    ...(transactionOptions ? { transactions: transactionOptions } : {}),
    chainDefinitions: chainDefinitionsOptions,
  };

  const settingsService = createSettingsService({ port: settingsOptions.port, now: storageNow });

  const networkPreferences = createNetworkPreferencesService({
    port: networkPreferencesOptions.port,
    defaults: { activeChainRef: DEFAULT_CHAIN.chainRef },
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
  const approvalFlowRegistry = createApprovalFlowRegistry();
  let signers: HandlerControllers["signers"] | undefined;

  const controllersInit = initControllers({
    bus,
    namespaceResolver: (ctx) => namespaceResolverFn(ctx),
    rpcRegistry,
    accountsService: accountsStore,
    settingsService,
    permissionsService,
    transactionsService,
    options: controllerOptions,
    createApprovalExecutor: (controllersBase) =>
      createApprovalExecutor({
        registry: approvalFlowRegistry,
        getDeps: () => {
          if (!signers) {
            throw new Error("Approval signers are not initialized");
          }

          return {
            accounts: controllersBase.accounts,
            permissions: controllersBase.permissions,
            transactions: controllersBase.transactions,
            network: controllersBase.network,
            networkPreferences,
            chainDefinitions: controllersBase.chainDefinitions,
            signers,
          };
        },
      }),
  });

  const {
    controllersBase,
    transactionRegistry,
    networkController,
    chainDefinitionsController,
    deferredNetworkInitialState,
  } = controllersInit;

  const chainViews = createChainViewsService({
    chainDefinitions: chainDefinitionsController,
    network: networkController,
  });

  const rpcClientRegistry = initRpcLayer({
    controllers: controllersBase,
    ...(rpcClientOptions ? { rpcClientOptions } : {}),
  });

  const vaultMetaPort = storageOptions?.vaultMetaPort;
  const attention = createAttentionService({
    messenger: bus.scope({ name: "attention", publish: ATTENTION_TOPICS }),
    now: storageNow,
  });

  const runtimeLifecycle = createRuntimeLifecycle("createBackgroundRuntime");
  const sessionLayer = initSessionLayer({
    bus,
    controllers: controllersBase,
    accountsStore,
    keyringMetas,
    storageLogger,
    storageNow,
    hydrationEnabled,
    getIsHydrating: () => runtimeLifecycle.getIsHydrating(),
    getIsDestroyed: () => runtimeLifecycle.getIsDestroyed(),
    ...(vaultMetaPort ? { vaultMetaPort } : {}),
    ...(sessionOptions ? { sessionOptions } : {}),
  });

  const engine = initEngine(engineOptions);

  const keyringService = sessionLayer.keyringService;
  const registeredAdapters = registerDefaultTransactionAdapters({
    transactionRegistry,
    rpcClients: rpcClientRegistry,
    chains: chainAddressCodecs,
    keyring: keyringService,
  });
  signers = registeredAdapters.signers;

  const controllers: HandlerControllers = {
    ...controllersBase,
    networkPreferences,
    chainAddressCodecs,
    clock: {
      now: storageNow,
    },
    signers,
  };

  namespaceResolverFn = rpcRegistry.createNamespaceResolver(controllers);

  const transactionsLifecycle = createTransactionsLifecycle({
    controller: controllers.transactions,
    service: transactionsService,
    unlock: sessionLayer.session.unlock,
    logger: storageLogger,
  });

  const networkBootstrap = createNetworkBootstrap({
    network: networkController,
    chainDefinitions: chainDefinitionsController,
    preferences: networkPreferences,
    hydrationEnabled,
    logger: storageLogger,
    getIsHydrating: () => runtimeLifecycle.getIsHydrating(),
  });

  const coreReadyPlugin: RuntimePlugin = {
    name: "coreReady",
    initialize: async () => {
      await chainDefinitionsController.whenReady();
      await controllersBase.accounts.whenReady?.();
      if (deferredNetworkInitialState) {
        const deferredChains = deferredNetworkInitialState.availableChainRefs.map((chainRef) => {
          const metadata = chainDefinitionsController.getChain(chainRef)?.metadata;
          if (!metadata) {
            throw new Error(`Deferred network state references missing chain definition ${chainRef}`);
          }
          return metadata;
        });
        networkController.replaceState(buildNetworkRuntimeInput(deferredNetworkInitialState, deferredChains));
      }
      await controllersBase.permissions.whenReady();
    },
  };

  const transactionsPlugin: RuntimePlugin = {
    name: "transactionsLifecycle",
    initialize: () => transactionsLifecycle.initialize(),
    start: () => transactionsLifecycle.start(),
    destroy: () => transactionsLifecycle.destroy(),
  };

  const networkBootstrapPlugin: RuntimePlugin = {
    name: "networkBootstrap",
    initialize: () => networkBootstrap.loadPreferences(),
    hydrate: async () => {
      networkBootstrap.requestSync();
    },
    afterHydration: () => networkBootstrap.flushPendingSync(),
    start: () => networkBootstrap.start(),
    destroy: () => networkBootstrap.destroy(),
  };

  const sessionPlugin: RuntimePlugin = {
    name: "sessionLayer",
    hydrate: () => sessionLayer.hydrateVaultMeta(),
    start: () => sessionLayer.attachSessionListeners(),
    destroy: () => {
      sessionLayer.cleanupVaultPersistTimer();
      sessionLayer.detachSessionListeners();
      sessionLayer.destroySessionLayer();
    },
  };

  const accountsControllerPlugin: RuntimePlugin = {
    name: "accountsController",
    destroy: () => {
      try {
        controllersBase.accounts.destroy?.();
      } catch (error) {
        storageLogger("lifecycle: failed to destroy accounts controller", error);
      }
    },
  };

  const permissionsControllerPlugin: RuntimePlugin = {
    name: "permissionsController",
    destroy: () => {
      try {
        controllersBase.permissions.destroy?.();
      } catch (error) {
        storageLogger("lifecycle: failed to destroy permissions controller", error);
      }
    },
  };

  const rpcClientsPlugin: RuntimePlugin = {
    name: "rpcClients",
    destroy: () => rpcClientRegistry.destroy(),
  };

  const enginePlugin: RuntimePlugin = {
    name: "rpcEngine",
    destroy: () => engine.destroy(),
  };

  const busPlugin: RuntimePlugin = {
    name: "messenger",
    destroy: () => bus.clear(),
  };

  const initializeOrder = [coreReadyPlugin, transactionsPlugin, networkBootstrapPlugin] as const;
  const hydrateOrder = [networkBootstrapPlugin, sessionPlugin] as const;
  const afterHydrationOrder = [networkBootstrapPlugin] as const;
  const startOrder = [networkBootstrapPlugin, sessionPlugin, transactionsPlugin] as const;
  const destroyOrder = [
    transactionsPlugin,
    sessionPlugin,
    networkBootstrapPlugin,
    accountsControllerPlugin,
    permissionsControllerPlugin,
    rpcClientsPlugin,
    enginePlugin,
    busPlugin,
  ] as const;

  const runtime: BackgroundRuntime = {
    bus,
    controllers,
    services: {
      attention,
      chainViews,
      session: sessionLayer.session,
      keyring: keyringService,
    },
    rpc: {
      engine,
      registry: rpcRegistry,
      clients: rpcClientRegistry,
      getActiveNamespace: namespaceResolverFn,
    },
    lifecycle: {
      initialize: async () =>
        runtimeLifecycle.initialize(async () => {
          await runPluginHooks([...initializeOrder], "initialize");
          await runtimeLifecycle.withHydration(async () => {
            await runPluginHooks([...hydrateOrder], "hydrate");
          });
          await runPluginHooks([...afterHydrationOrder], "afterHydration");
        }),
      start: () =>
        runtimeLifecycle.start(() => {
          startPlugins([...startOrder]);
        }),
      destroy: () =>
        runtimeLifecycle.destroy(() => {
          for (const plugin of destroyOrder) {
            try {
              plugin.destroy?.();
            } catch {
              // best-effort
            }
          }
        }),
      getIsInitialized: () => runtimeLifecycle.getIsInitialized(),
    },
  };

  // Assemble the RPC pipeline exactly once per engine instance (default: enabled).
  if (rpcEngineOptions.assemble !== false) {
    createRpcEngineForBackground(runtime, rpcEngineOptions.env);
  }

  return runtime;
};
