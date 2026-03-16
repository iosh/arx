import type { AccountCodecRegistry } from "../accounts/addressing/codec.js";
import { createApprovalExecutor, createApprovalFlowRegistry } from "../approvals/index.js";
import type { Messenger, ViolationMode } from "../messenger/Messenger.js";
import {
  assembleRuntimeNamespaceStages,
  type NamespaceManifest,
  type NamespaceRuntimeBindingsRegistry,
  type NamespaceRuntimeSupportIndex,
} from "../namespaces/index.js";
import type { HandlerControllers, Namespace } from "../rpc/handlers/types.js";
import { createRpcRegistry, type RpcInvocationContext } from "../rpc/index.js";
import type { createAttentionService } from "../services/runtime/attention/index.js";
import { ATTENTION_STATE_CHANGED } from "../services/runtime/attention/index.js";
import type { createChainActivationService } from "../services/runtime/chainActivation/index.js";
import type { createChainViewsService } from "../services/runtime/chainViews/index.js";
import type { createPermissionViewsService } from "../services/runtime/permissionViews/index.js";
import type { AccountsPort } from "../services/store/accounts/port.js";
import type { KeyringMetasPort } from "../services/store/keyringMetas/port.js";
import type { NetworkPreferencesPort } from "../services/store/networkPreferences/port.js";
import type { NetworkPreferencesService } from "../services/store/networkPreferences/types.js";
import type { PermissionsPort } from "../services/store/permissions/port.js";
import type { SettingsPort } from "../services/store/settings/port.js";
import type { TransactionsPort } from "../services/store/transactions/port.js";
import type { VaultMetaPort } from "../storage/index.js";
import type { UiError } from "../ui/protocol/envelopes.js";
import { createUiRuntimeAccess } from "../ui/server/access.js";
import type { UiPlatformAdapter, UiRuntimeAccess, UiRuntimeDeps } from "../ui/server/types.js";
import type { ControllerLayerOptions } from "./background/controllers.js";
import type { EngineOptions, initEngine } from "./background/engine.js";
import { type BackgroundRpcEnvHooks, createRpcEngineForBackground } from "./background/rpcEngineAssembly.js";
import type { initRpcLayer, RpcLayerOptions } from "./background/rpcLayer.js";
import { createBackgroundRuntimeLifecycle } from "./background/runtimeLifecyclePlan.js";
import {
  initializeRuntimeBootstrapPhase,
  initializeRuntimeSessionPhase,
  initializeRuntimeSupportPhase,
} from "./background/runtimePhases.js";
import type { BackgroundSessionServices, SessionOptions } from "./background/session.js";
import type { KeyringService } from "./keyring/KeyringService.js";
import { createProviderRuntimeAccess } from "./provider/index.js";
import type { ProviderRuntimeAccess } from "./provider/types.js";

export type { UiPlatformAdapter, UiRuntimeAccess } from "../ui/server/types.js";
export type { BackgroundSessionServices } from "./background/session.js";

export type BackgroundRuntimeUiAccessOptions = {
  platform: UiPlatformAdapter;
  uiOrigin: string;
};

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
  namespaces: {
    manifests: readonly NamespaceManifest[];
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
    namespaceRuntimeSupport: NamespaceRuntimeSupportIndex;
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
  providerAccess: ProviderRuntimeAccess;
  createUiAccess: (options: BackgroundRuntimeUiAccessOptions) => UiRuntimeAccess;
};

const createBackgroundRuntimeUiDeps = (
  runtime: BackgroundRuntime,
  { platform, uiOrigin }: BackgroundRuntimeUiAccessOptions,
): UiRuntimeDeps => ({
  accounts: runtime.controllers.accounts,
  approvals: runtime.controllers.approvals,
  permissions: {
    buildUiPermissionsSnapshot: () => runtime.services.permissionViews.buildUiPermissionsSnapshot(),
    onStateChanged: (listener) => runtime.controllers.permissions.onStateChanged(listener),
  },
  transactions: runtime.controllers.transactions,
  chains: {
    buildWalletNetworksSnapshot: () => runtime.services.chainViews.buildWalletNetworksSnapshot(),
    findAvailableChainView: (chainRef) => runtime.services.chainViews.findAvailableChainView(chainRef),
    getApprovalReviewChainView: (chainRef) => runtime.services.chainViews.getApprovalReviewChainView(chainRef),
    getPreferredChainViewForNamespace: (namespace) =>
      runtime.services.chainViews.getPreferredChainViewForNamespace(namespace),
    getSelectedChainView: () => runtime.services.chainViews.getSelectedChainView(),
    requireAvailableChainMetadata: (chainRef) => runtime.services.chainViews.requireAvailableChainMetadata(chainRef),
    selectWalletChain: (chainRef) => runtime.services.chainActivation.selectWalletChain(chainRef),
    onStateChanged: (listener) => runtime.controllers.network.onStateChanged(listener),
    onPreferencesChanged: (listener) => runtime.services.networkPreferences.subscribeChanged(() => listener()),
  },
  accountCodecs: runtime.services.accountCodecs,
  session: {
    unlock: runtime.services.session.unlock,
    vault: runtime.services.session.vault,
    withVaultMetaPersistHold: runtime.services.session.withVaultMetaPersistHold,
    persistVaultMeta: runtime.services.session.persistVaultMeta,
  },
  keyrings: runtime.services.keyring,
  attention: {
    getSnapshot: () => runtime.services.attention.getSnapshot(),
    onStateChanged: (listener) => runtime.bus.subscribe(ATTENTION_STATE_CHANGED, listener),
  },
  namespaceBindings: runtime.services.namespaceBindings,
  errorEncoder: {
    encodeError: (error, context) =>
      runtime.rpc.registry.encodeErrorWithAdapters(error, {
        surface: "ui",
        namespace: context.namespace,
        chainRef: context.chainRef,
        method: context.method,
      }) as UiError,
  },
  platform,
  uiOrigin,
});

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

  const namespaceManifests = namespacesOptions.manifests;
  const namespaceStages = assembleRuntimeNamespaceStages(namespaceManifests);
  const bootstrapPhase = initializeRuntimeBootstrapPhase({
    rpcRegistry,
    namespaceBootstrap: namespaceStages.bootstrap,
    ...(messengerOptions ? { messengerOptions } : {}),
    ...(storageOptions ? { storageOptions } : {}),
    ...(networkOptions ? { networkOptions } : {}),
    ...(accountOptions ? { accountOptions } : {}),
    ...(approvalOptions ? { approvalOptions } : {}),
    ...(permissionOptions ? { permissionOptions } : {}),
    ...(transactionOptions ? { transactionOptions } : {}),
    chainDefinitionsOptions,
  });
  const approvalFlowRegistry = createApprovalFlowRegistry();
  let sessionPhase: ReturnType<typeof initializeRuntimeSessionPhase> | null = null;
  let runtimeSupportPhase: ReturnType<typeof initializeRuntimeSupportPhase> | null = null;

  const requireSessionPhase = () => {
    if (!sessionPhase) {
      throw new Error("Runtime session phase is not initialized");
    }
    return sessionPhase;
  };

  const requireRuntimeSupportPhase = () => {
    if (!runtimeSupportPhase) {
      throw new Error("Runtime support phase is not initialized");
    }
    return runtimeSupportPhase;
  };

  sessionPhase = initializeRuntimeSessionPhase({
    bootstrapPhase,
    namespaceSession: namespaceStages.session,
    settingsPort: settingsOptions.port,
    networkPreferencesPort: networkPreferencesOptions.port,
    storePorts: storeOptions.ports,
    ...(engineOptions ? { engineOptions } : {}),
    ...(storageOptions?.vaultMetaPort ? { vaultMetaPort: storageOptions.vaultMetaPort } : {}),
    ...(sessionOptions ? { sessionOptions } : {}),
    createApprovalExecutor: (controllersBase) =>
      createApprovalExecutor({
        registry: approvalFlowRegistry,
        getDeps: () => {
          const activeSessionPhase = requireSessionPhase();
          const activeRuntimeSupportPhase = requireRuntimeSupportPhase();

          return {
            accounts: controllersBase.accounts,
            permissions: controllersBase.permissions,
            transactions: controllersBase.transactions,
            chainActivation: activeSessionPhase.chainActivation,
            chainDefinitions: controllersBase.chainDefinitions,
            namespaceBindings: activeRuntimeSupportPhase.namespaceBindings,
          };
        },
      }),
  });

  runtimeSupportPhase = initializeRuntimeSupportPhase({
    bootstrapPhase,
    sessionPhase,
    namespaceRuntimeSupport: namespaceStages.runtimeSupport,
    ...(rpcClientOptions ? { rpcClientOptions } : {}),
  });

  const controllers: HandlerControllers = {
    ...sessionPhase.controllersBase,
    networkPreferences: sessionPhase.networkPreferences,
    chainAddressCodecs: bootstrapPhase.namespaceBootstrap.chainAddressCodecs,
    clock: {
      now: bootstrapPhase.storageNow,
    },
    signers: runtimeSupportPhase.signers,
  };
  const lifecycle = createBackgroundRuntimeLifecycle({
    runtimeLifecycle: sessionPhase.runtimeLifecycle,
    controllersBase: sessionPhase.controllersBase,
    deferredNetworkInitialState: sessionPhase.deferredNetworkInitialState,
    registeredNamespaces: bootstrapPhase.registeredNamespaces,
    transactionsLifecycle: runtimeSupportPhase.transactionsLifecycle,
    networkBootstrap: runtimeSupportPhase.networkBootstrap,
    sessionLayer: sessionPhase.sessionLayer,
    rpcClientRegistry: runtimeSupportPhase.rpcClientRegistry,
    engine: sessionPhase.engine,
    bus: bootstrapPhase.bus,
    logger: bootstrapPhase.storageLogger,
  });

  const runtime = {
    bus: bootstrapPhase.bus,
    controllers,
    services: {
      attention: sessionPhase.attention,
      chainActivation: sessionPhase.chainActivation,
      chainViews: sessionPhase.chainViews,
      permissionViews: runtimeSupportPhase.permissionViews,
      accountCodecs: bootstrapPhase.namespaceBootstrap.accountCodecs,
      networkPreferences: sessionPhase.networkPreferences,
      namespaceBindings: runtimeSupportPhase.namespaceBindings,
      namespaceRuntimeSupport: runtimeSupportPhase.namespaceRuntimeSupport,
      session: sessionPhase.sessionLayer.session,
      keyring: sessionPhase.keyringService,
    },
    rpc: {
      engine: sessionPhase.engine,
      registry: rpcRegistry,
      clients: runtimeSupportPhase.rpcClientRegistry,
      getActiveNamespace: bootstrapPhase.contextNamespaceResolver,
    },
    lifecycle,
  } as BackgroundRuntime;

  runtime.providerAccess = createProviderRuntimeAccess(runtime);
  runtime.createUiAccess = (options) => createUiRuntimeAccess(createBackgroundRuntimeUiDeps(runtime, options));

  if (rpcEngineOptions.assemble !== false) {
    createRpcEngineForBackground(runtime, rpcEngineOptions.env);
  }

  return runtime;
};
