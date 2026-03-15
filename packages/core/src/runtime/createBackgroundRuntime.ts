import type { AccountCodecRegistry } from "../accounts/addressing/codec.js";
import { createApprovalExecutor, createApprovalFlowRegistry } from "../approvals/index.js";
import type { Messenger, ViolationMode } from "../messenger/Messenger.js";
import type { NamespaceManifest, NamespaceRuntimeBindingsRegistry } from "../namespaces/index.js";
import type { HandlerControllers, Namespace } from "../rpc/handlers/types.js";
import { createRpcRegistry, type RpcInvocationContext } from "../rpc/index.js";
import type { createAttentionService } from "../services/runtime/attention/index.js";
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
import type { ControllerLayerOptions } from "./background/controllers.js";
import type { EngineOptions, initEngine } from "./background/engine.js";
import { type BackgroundRpcEnvHooks, createRpcEngineForBackground } from "./background/rpcEngineAssembly.js";
import type { initRpcLayer, RpcLayerOptions } from "./background/rpcLayer.js";
import { createBackgroundRuntimeLifecycle } from "./background/runtimeLifecyclePlan.js";
import {
  initializeRuntimeBootstrapPhase,
  initializeRuntimeCapabilityPhase,
  initializeRuntimeSessionPhase,
} from "./background/runtimePhases.js";
import type { BackgroundSessionServices, SessionOptions } from "./background/session.js";
import type { KeyringService } from "./keyring/KeyringService.js";
import { createProviderRuntimeSurface } from "./surfaces/provider/index.js";
import type { ProviderRuntimeSurface } from "./surfaces/provider/types.js";

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
  surfaces: {
    provider: ProviderRuntimeSurface;
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

  const namespaceManifests = namespacesOptions.manifests;
  const bootstrapPhase = initializeRuntimeBootstrapPhase({
    rpcRegistry,
    namespaceManifests,
    ...(messengerOptions ? { messengerOptions } : {}),
    ...(storageOptions ? { storageOptions } : {}),
    ...(networkOptions ? { networkOptions } : {}),
    ...(accountOptions ? { accountOptions } : {}),
    ...(approvalOptions ? { approvalOptions } : {}),
    ...(permissionOptions ? { permissionOptions } : {}),
    ...(transactionOptions ? { transactionOptions } : {}),
    chainDefinitionsOptions,
    ...(sessionOptions ? { sessionOptions } : {}),
  });
  const approvalFlowRegistry = createApprovalFlowRegistry();
  let sessionPhase: ReturnType<typeof initializeRuntimeSessionPhase> | null = null;
  let capabilityPhase: ReturnType<typeof initializeRuntimeCapabilityPhase> | null = null;

  const requireSessionPhase = () => {
    if (!sessionPhase) {
      throw new Error("Runtime session phase is not initialized");
    }
    return sessionPhase;
  };

  const requireCapabilityPhase = () => {
    if (!capabilityPhase) {
      throw new Error("Runtime capability phase is not initialized");
    }
    return capabilityPhase;
  };

  sessionPhase = initializeRuntimeSessionPhase({
    bootstrapPhase,
    settingsPort: settingsOptions.port,
    networkPreferencesPort: networkPreferencesOptions.port,
    storePorts: storeOptions.ports,
    ...(engineOptions ? { engineOptions } : {}),
    ...(storageOptions?.vaultMetaPort ? { vaultMetaPort: storageOptions.vaultMetaPort } : {}),
    createApprovalExecutor: (controllersBase) =>
      createApprovalExecutor({
        registry: approvalFlowRegistry,
        getDeps: () => {
          const activeSessionPhase = requireSessionPhase();
          const activeCapabilityPhase = requireCapabilityPhase();

          return {
            accounts: controllersBase.accounts,
            permissions: controllersBase.permissions,
            transactions: controllersBase.transactions,
            chainActivation: activeSessionPhase.chainActivation,
            chainDefinitions: controllersBase.chainDefinitions,
            namespaceBindings: activeCapabilityPhase.namespaceBindings,
          };
        },
      }),
  });

  capabilityPhase = initializeRuntimeCapabilityPhase({
    bootstrapPhase,
    sessionPhase,
    ...(rpcClientOptions ? { rpcClientOptions } : {}),
  });

  const controllers: HandlerControllers = {
    ...sessionPhase.controllersBase,
    networkPreferences: sessionPhase.networkPreferences,
    chainAddressCodecs: bootstrapPhase.chainAddressCodecs,
    clock: {
      now: bootstrapPhase.storageNow,
    },
    signers: capabilityPhase.signers,
  };
  const lifecycle = createBackgroundRuntimeLifecycle({
    runtimeLifecycle: sessionPhase.runtimeLifecycle,
    controllersBase: sessionPhase.controllersBase,
    deferredNetworkInitialState: sessionPhase.deferredNetworkInitialState,
    registeredNamespaces: bootstrapPhase.registeredNamespaces,
    transactionsLifecycle: capabilityPhase.transactionsLifecycle,
    networkBootstrap: capabilityPhase.networkBootstrap,
    sessionLayer: sessionPhase.sessionLayer,
    rpcClientRegistry: capabilityPhase.rpcClientRegistry,
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
      permissionViews: capabilityPhase.permissionViews,
      accountCodecs: bootstrapPhase.accountCodecs,
      networkPreferences: sessionPhase.networkPreferences,
      namespaceBindings: capabilityPhase.namespaceBindings,
      session: sessionPhase.sessionLayer.session,
      keyring: sessionPhase.keyringService,
    },
    rpc: {
      engine: sessionPhase.engine,
      registry: rpcRegistry,
      clients: capabilityPhase.rpcClientRegistry,
      getActiveNamespace: bootstrapPhase.contextNamespaceResolver,
    },
    lifecycle,
  } as BackgroundRuntime;

  runtime.surfaces = {
    provider: createProviderRuntimeSurface(runtime),
  };

  if (rpcEngineOptions.assemble !== false) {
    createRpcEngineForBackground(runtime, rpcEngineOptions.env);
  }

  return runtime;
};
