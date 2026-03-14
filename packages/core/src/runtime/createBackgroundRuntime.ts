import type { AccountCodecRegistry } from "../accounts/addressing/codec.js";
import { createApprovalExecutor, createApprovalFlowRegistry } from "../approvals/index.js";
import { Messenger, type ViolationMode } from "../messenger/Messenger.js";
import {
  assembleRuntimeNamespaces,
  BUILTIN_NAMESPACE_MANIFESTS,
  collectChainSeedsFromManifests,
  createAccountCodecRegistryFromManifests,
  createChainAddressCodecRegistryFromManifests,
  createKeyringNamespacesFromManifests,
  type NamespaceManifest,
  type NamespaceRuntimeBindingsRegistry,
  registerRpcModulesFromManifests,
} from "../namespaces/index.js";
import type { HandlerControllers, Namespace } from "../rpc/handlers/types.js";
import { createRpcRegistry, type RpcInvocationContext } from "../rpc/index.js";
import { ATTENTION_TOPICS, createAttentionService } from "../services/runtime/attention/index.js";
import { createChainActivationService } from "../services/runtime/chainActivation/index.js";
import { createChainViewsService } from "../services/runtime/chainViews/index.js";
import { createPermissionViewsService } from "../services/runtime/permissionViews/index.js";
import type { AccountsPort } from "../services/store/accounts/port.js";
import type { KeyringMetasPort } from "../services/store/keyringMetas/port.js";
import type { NetworkPreferencesPort } from "../services/store/networkPreferences/port.js";
import type { NetworkPreferencesService } from "../services/store/networkPreferences/types.js";
import type { PermissionsPort } from "../services/store/permissions/port.js";
import type { SettingsPort } from "../services/store/settings/port.js";
import type { TransactionsPort } from "../services/store/transactions/port.js";
import type { VaultMetaPort } from "../storage/index.js";
import { type ControllerLayerOptions, initControllers } from "./background/controllers.js";
import { type EngineOptions, initEngine } from "./background/engine.js";
import { createNetworkBootstrap } from "./background/networkBootstrap.js";
import { type BackgroundRpcEnvHooks, createRpcEngineForBackground } from "./background/rpcEngineAssembly.js";
import { initRpcLayer, type RpcLayerOptions } from "./background/rpcLayer.js";
import { createRuntimeLifecycle } from "./background/runtimeLifecycle.js";
import { createBackgroundRuntimeLifecycle } from "./background/runtimeLifecyclePlan.js";
import { initRuntimeStoreServices } from "./background/runtimeStoreServices.js";
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
  namespaces?: {
    manifests?: readonly NamespaceManifest[];
  };
};

export type BackgroundRuntime = {
  bus: Messenger;
  controllers: HandlerControllers;
  services: {
    attention: ReturnType<typeof createAttentionService>;
    chainActivation: ReturnType<typeof createChainActivationService>;
    chainViews: ReturnType<typeof createChainViewsService>;
    permissionViews: ReturnType<typeof createPermissionViewsService>;
    accountCodecs: AccountCodecRegistry;
    networkPreferences: NetworkPreferencesService;
    namespaceBindings: NamespaceRuntimeBindingsRegistry;
    session: BackgroundSessionServices;
    keyring: KeyringService;
  };
  rpc: {
    engine: ReturnType<typeof initEngine>;
    registry: ReturnType<typeof createRpcRegistry>;
    clients: ReturnType<typeof initRpcLayer>;
    getActiveNamespace: (context?: RpcInvocationContext) => Namespace | null;
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
    namespaces: namespacesOptions,
  } = options;

  const namespaceManifests = namespacesOptions?.manifests ?? BUILTIN_NAMESPACE_MANIFESTS;
  registerRpcModulesFromManifests(rpcRegistry, namespaceManifests);

  const storageLogger = storageOptions?.logger ?? (() => {});
  const bus = new Messenger({
    violationMode: messengerOptions?.violationMode ?? "throw",
    onListenerError: ({ topic, error }) => storageLogger(`messenger: listener error in "${topic}"`, error),
    onViolation: (info) => storageLogger(`messenger: violation(${info.kind}) "${info.topic}"`, info),
  });
  const accountCodecs = createAccountCodecRegistryFromManifests(namespaceManifests);
  const chainAddressCodecs = createChainAddressCodecRegistryFromManifests(namespaceManifests);
  const registeredNamespaces = new Set(rpcRegistry.getRegisteredNamespaces());
  const chainDefinitionSeed = chainDefinitionsOptions.seed ?? collectChainSeedsFromManifests(namespaceManifests);
  const resolvedSessionOptions = sessionOptions?.keyringNamespaces
    ? sessionOptions
    : {
        ...sessionOptions,
        keyringNamespaces: createKeyringNamespacesFromManifests(namespaceManifests),
      };

  const methodNamespaceResolver = rpcRegistry.createMethodNamespaceResolver();
  const contextNamespaceResolver = rpcRegistry.createNamespaceResolver();
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
    chainDefinitions: { ...chainDefinitionsOptions, seed: chainDefinitionSeed },
  };

  const { settingsService, networkPreferences, transactionsService, permissionsService, accountsStore, keyringMetas } =
    initRuntimeStoreServices({
      settingsPort: settingsOptions.port,
      networkPreferencesPort: networkPreferencesOptions.port,
      ports: storeOptions.ports,
      now: storageNow,
    });
  const approvalFlowRegistry = createApprovalFlowRegistry();

  const controllersInit = initControllers({
    bus,
    namespaceResolver: methodNamespaceResolver,
    rpcRegistry,
    accountCodecs,
    accountsService: accountsStore,
    settingsService,
    permissionsService,
    transactionsService,
    networkPreferences,
    options: controllerOptions,
    createApprovalExecutor: (controllersBase) =>
      createApprovalExecutor({
        registry: approvalFlowRegistry,
        getDeps: () => {
          if (!chainActivation) {
            throw new Error("Chain activation service is not initialized");
          }
          if (!namespaceBindings) {
            throw new Error("Namespace approval bindings are not initialized");
          }

          return {
            accounts: controllersBase.accounts,
            permissions: controllersBase.permissions,
            transactions: controllersBase.transactions,
            chainActivation,
            chainDefinitions: controllersBase.chainDefinitions,
            namespaceBindings,
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
    preferences: networkPreferences,
  });

  const chainActivation = createChainActivationService({
    network: networkController,
    preferences: networkPreferences,
    logger: storageLogger,
  });

  const rpcClientRegistry = initRpcLayer({
    controllers: controllersBase,
    namespaceManifests,
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
    ...(resolvedSessionOptions ? { sessionOptions: resolvedSessionOptions } : {}),
  });

  const engine = initEngine(engineOptions);

  const keyringService = sessionLayer.keyringService;
  const assembledRuntimeNamespaces = assembleRuntimeNamespaces({
    manifests: namespaceManifests,
    transactionRegistry,
    rpcClients: rpcClientRegistry,
    chains: chainAddressCodecs,
    keyring: keyringService,
  });
  const signers = assembledRuntimeNamespaces.signers;
  const namespaceBindings = assembledRuntimeNamespaces.bindings;

  const controllers: HandlerControllers = {
    ...controllersBase,
    networkPreferences,
    chainAddressCodecs,
    clock: {
      now: storageNow,
    },
    signers,
  };

  const permissionViews = createPermissionViewsService({
    accounts: controllers.accounts,
    permissions: controllers.permissions,
  });

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
    getRegisteredNamespaces: () => registeredNamespaces,
  });
  const lifecycle = createBackgroundRuntimeLifecycle({
    runtimeLifecycle,
    controllersBase,
    deferredNetworkInitialState,
    registeredNamespaces,
    transactionsLifecycle,
    networkBootstrap,
    sessionLayer,
    rpcClientRegistry,
    engine,
    bus,
    logger: storageLogger,
  });

  const runtime: BackgroundRuntime = {
    bus,
    controllers,
    services: {
      attention,
      chainActivation,
      chainViews,
      permissionViews,
      accountCodecs,
      networkPreferences,
      namespaceBindings,
      session: sessionLayer.session,
      keyring: keyringService,
    },
    rpc: {
      engine,
      registry: rpcRegistry,
      clients: rpcClientRegistry,
      getActiveNamespace: contextNamespaceResolver,
    },
    lifecycle,
  };

  if (rpcEngineOptions.assemble !== false) {
    createRpcEngineForBackground(runtime, rpcEngineOptions.env);
  }

  return runtime;
};
