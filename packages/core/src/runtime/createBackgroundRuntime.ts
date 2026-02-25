import { createDefaultChainDescriptorRegistry } from "../chains/registry.js";
import { Messenger, type ViolationMode } from "../messenger/Messenger.js";
import { EIP155_NAMESPACE } from "../rpc/handlers/namespaces/utils.js";
import type { HandlerControllers, Namespace } from "../rpc/handlers/types.js";
import { createRpcRegistry, type RpcInvocationContext, registerBuiltinRpcAdapters } from "../rpc/index.js";
import { createAccountsService } from "../services/accounts/AccountsService.js";
import type { AccountsPort } from "../services/accounts/port.js";
import { ATTENTION_TOPICS, createAttentionService } from "../services/attention/index.js";
import { createKeyringMetasService } from "../services/keyringMetas/KeyringMetasService.js";
import type { KeyringMetasPort } from "../services/keyringMetas/port.js";
import { createNetworkPreferencesService } from "../services/networkPreferences/NetworkPreferencesService.js";
import type { NetworkPreferencesPort } from "../services/networkPreferences/port.js";
import { createPermissionsService } from "../services/permissions/PermissionsService.js";
import type { PermissionsPort } from "../services/permissions/port.js";
import type { SettingsPort } from "../services/settings/port.js";
import { createSettingsService } from "../services/settings/SettingsService.js";
import type { TransactionsPort } from "../services/transactions/port.js";
import { createTransactionsService } from "../services/transactions/TransactionsService.js";
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

export type CreateBackgroundRuntimeOptions = Omit<ControllerLayerOptions, "chainRegistry"> & {
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
  chainRegistry: NonNullable<ControllerLayerOptions["chainRegistry"]>;
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
    chainRegistry: chainRegistryOptions,
    rpcClients: rpcClientOptions,
  } = options;

  const storageLogger = storageOptions?.logger ?? (() => {});
  const bus = new Messenger({
    violationMode: messengerOptions?.violationMode ?? "throw",
    onListenerError: ({ topic, error }) => storageLogger(`messenger: listener error in "${topic}"`, error),
    onViolation: (info) => storageLogger(`messenger: violation(${info.kind}) "${info.topic}"`, info),
  });
  const chainDescriptors = createDefaultChainDescriptorRegistry();

  let namespaceResolverFn: (context?: RpcInvocationContext) => Namespace = () => EIP155_NAMESPACE;
  const storageNow = storageOptions?.now ?? Date.now;
  const hydrationEnabled = storageOptions?.hydrate ?? true;

  const controllerOptions: ControllerLayerOptions = {
    ...(networkOptions ? { network: networkOptions } : {}),
    ...(accountOptions ? { accounts: accountOptions } : {}),
    ...(approvalOptions ? { approvals: { ...approvalOptions, logger: approvalOptions.logger ?? storageLogger } } : {}),
    ...(permissionOptions
      ? { permissions: { ...permissionOptions, chains: chainDescriptors } }
      : { permissions: { chains: chainDescriptors } }),
    ...(transactionOptions ? { transactions: transactionOptions } : {}),
    chainRegistry: chainRegistryOptions,
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

  const controllersInit = initControllers({
    bus,
    namespaceResolver: (ctx) => namespaceResolverFn(ctx),
    rpcRegistry,
    accountsService: accountsStore,
    settingsService,
    permissionsService,
    transactionsService,
    options: controllerOptions,
  });

  const { controllersBase, transactionRegistry, networkController, chainRegistryController } = controllersInit;

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
  const { signers } = registerDefaultTransactionAdapters({
    transactionRegistry,
    rpcClients: rpcClientRegistry,
    chains: chainDescriptors,
    keyring: keyringService,
  });

  const controllers: HandlerControllers = {
    ...controllersBase,
    networkPreferences,
    chainDescriptors,
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
    chainRegistry: chainRegistryController,
    preferences: networkPreferences,
    hydrationEnabled,
    logger: storageLogger,
    getIsHydrating: () => runtimeLifecycle.getIsHydrating(),
  });

  const coreReadyPlugin: RuntimePlugin = {
    name: "coreReady",
    initialize: async () => {
      await chainRegistryController.whenReady();
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
    rpcClientsPlugin,
    enginePlugin,
    busPlugin,
  ] as const;

  const runtime: BackgroundRuntime = {
    bus,
    controllers,
    services: {
      attention,
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
