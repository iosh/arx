import type { AccountCodecRegistry } from "../../accounts/addressing/codec.js";
import type { ApprovalExecutor } from "../../approvals/types.js";
import type { ChainMetadata } from "../../chains/metadata.js";
import { Messenger, type ViolationMode } from "../../messenger/Messenger.js";
import {
  assembleRuntimeNamespaces,
  collectChainSeedsFromManifests,
  createAccountCodecRegistryFromManifests,
  createChainAddressCodecRegistryFromManifests,
  createKeyringNamespacesFromManifests,
  type NamespaceManifest,
  type NamespaceRuntimeBindingsRegistry,
  registerRpcModulesFromManifests,
} from "../../namespaces/index.js";
import type { HandlerControllers, Namespace } from "../../rpc/handlers/types.js";
import type { RpcInvocationContext, RpcRegistry } from "../../rpc/index.js";
import { ATTENTION_TOPICS, createAttentionService } from "../../services/runtime/attention/index.js";
import { createChainActivationService } from "../../services/runtime/chainActivation/index.js";
import { createChainViewsService } from "../../services/runtime/chainViews/index.js";
import { createPermissionViewsService } from "../../services/runtime/permissionViews/index.js";
import type { AccountsPort } from "../../services/store/accounts/port.js";
import type { KeyringMetasPort } from "../../services/store/keyringMetas/port.js";
import type { NetworkPreferencesPort } from "../../services/store/networkPreferences/port.js";
import type { NetworkPreferencesService } from "../../services/store/networkPreferences/types.js";
import type { PermissionsPort } from "../../services/store/permissions/port.js";
import type { SettingsPort } from "../../services/store/settings/port.js";
import type { TransactionsPort } from "../../services/store/transactions/port.js";
import type { VaultMetaPort } from "../../storage/index.js";
import type { KeyringService } from "../keyring/KeyringService.js";
import { type ControllerLayerOptions, type ControllersBase, initControllers } from "./controllers.js";
import { type EngineOptions, initEngine } from "./engine.js";
import { createNetworkBootstrap } from "./networkBootstrap.js";
import { buildRuntimeNetworkPlan, type RuntimeNetworkPlan } from "./networkDefaults.js";
import { initRpcLayer, type RpcLayerOptions } from "./rpcLayer.js";
import { createRuntimeLifecycle } from "./runtimeLifecycle.js";
import { initRuntimeStoreServices } from "./runtimeStoreServices.js";
import { initSessionLayer, type SessionLayerResult, type SessionOptions } from "./session.js";
import { createTransactionsLifecycle } from "./transactionsLifecycle.js";

type StorageOptions = {
  vaultMetaPort?: VaultMetaPort;
  now?: () => number;
  hydrate?: boolean;
  logger?: (message: string, error?: unknown) => void;
};

type MessengerOptions = {
  violationMode?: ViolationMode;
};

type BackgroundNamespaceResolver = (context?: RpcInvocationContext) => Namespace | null;

export type RuntimeBootstrapPhase = {
  bus: Messenger;
  rpcRegistry: RpcRegistry;
  namespaceManifests: readonly NamespaceManifest[];
  registeredNamespaces: ReadonlySet<string>;
  accountCodecs: AccountCodecRegistry;
  chainAddressCodecs: ReturnType<typeof createChainAddressCodecRegistryFromManifests>;
  admittedChains: readonly ChainMetadata[];
  networkPlan: RuntimeNetworkPlan;
  contextNamespaceResolver: BackgroundNamespaceResolver;
  storageLogger: (message: string, error?: unknown) => void;
  storageNow: () => number;
  hydrationEnabled: boolean;
  controllerOptions: ControllerLayerOptions;
  resolvedSessionOptions?: SessionOptions;
};

export type RuntimeSessionPhase = {
  controllersBase: ControllersBase;
  deferredNetworkInitialState: ReturnType<typeof initControllers>["deferredNetworkInitialState"];
  transactionRegistry: ReturnType<typeof initControllers>["transactionRegistry"];
  chainViews: ReturnType<typeof createChainViewsService>;
  chainActivation: ReturnType<typeof createChainActivationService>;
  attention: ReturnType<typeof createAttentionService>;
  networkPreferences: NetworkPreferencesService;
  sessionLayer: SessionLayerResult;
  keyringService: KeyringService;
  runtimeLifecycle: ReturnType<typeof createRuntimeLifecycle>;
  engine: ReturnType<typeof initEngine>;
  transactionsService: ReturnType<typeof initRuntimeStoreServices>["transactionsService"];
};

export type RuntimeCapabilityPhase = {
  rpcClientRegistry: ReturnType<typeof initRpcLayer>;
  signers: HandlerControllers["signers"];
  namespaceBindings: NamespaceRuntimeBindingsRegistry;
  permissionViews: ReturnType<typeof createPermissionViewsService>;
  transactionsLifecycle: ReturnType<typeof createTransactionsLifecycle>;
  networkBootstrap: ReturnType<typeof createNetworkBootstrap>;
};

export const initializeRuntimeBootstrapPhase = ({
  rpcRegistry,
  namespaceManifests,
  messengerOptions,
  storageOptions,
  networkOptions,
  accountOptions,
  approvalOptions,
  permissionOptions,
  transactionOptions,
  chainDefinitionsOptions,
  sessionOptions,
}: {
  rpcRegistry: RpcRegistry;
  namespaceManifests: readonly NamespaceManifest[];
  messengerOptions?: MessengerOptions;
  storageOptions?: StorageOptions;
  networkOptions?: ControllerLayerOptions["network"];
  accountOptions?: ControllerLayerOptions["accounts"];
  approvalOptions?: ControllerLayerOptions["approvals"];
  permissionOptions?: ControllerLayerOptions["permissions"];
  transactionOptions?: ControllerLayerOptions["transactions"];
  chainDefinitionsOptions: NonNullable<ControllerLayerOptions["chainDefinitions"]>;
  sessionOptions?: SessionOptions;
}): RuntimeBootstrapPhase => {
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
  const networkPlan = buildRuntimeNetworkPlan({
    admittedChains: chainDefinitionSeed.filter((entry) => registeredNamespaces.has(entry.namespace)),
    ...(networkOptions?.initialState ? { requestedInitialState: networkOptions.initialState } : {}),
    ...(networkOptions?.defaultStrategy ? { defaultStrategy: networkOptions.defaultStrategy } : {}),
  });
  const resolvedSessionOptions = sessionOptions?.keyringNamespaces
    ? sessionOptions
    : {
        ...sessionOptions,
        keyringNamespaces: createKeyringNamespacesFromManifests(namespaceManifests),
      };

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

  return {
    bus,
    rpcRegistry,
    namespaceManifests,
    registeredNamespaces,
    accountCodecs,
    chainAddressCodecs,
    admittedChains: networkPlan.admittedChains,
    networkPlan,
    contextNamespaceResolver,
    storageLogger,
    storageNow,
    hydrationEnabled,
    controllerOptions,
    ...(resolvedSessionOptions ? { resolvedSessionOptions } : {}),
  };
};

export const initializeRuntimeSessionPhase = ({
  bootstrapPhase,
  settingsPort,
  networkPreferencesPort,
  storePorts,
  engineOptions,
  vaultMetaPort,
  createApprovalExecutor,
}: {
  bootstrapPhase: RuntimeBootstrapPhase;
  settingsPort: SettingsPort;
  networkPreferencesPort: NetworkPreferencesPort;
  storePorts: {
    transactions: TransactionsPort;
    accounts: AccountsPort;
    keyringMetas: KeyringMetasPort;
    permissions: PermissionsPort;
  };
  engineOptions?: EngineOptions;
  vaultMetaPort?: VaultMetaPort;
  createApprovalExecutor?: (controllersBase: ControllersBase) => ApprovalExecutor | undefined;
}): RuntimeSessionPhase => {
  const { settingsService, networkPreferences, transactionsService, permissionsService, accountsStore, keyringMetas } =
    initRuntimeStoreServices({
      settingsPort,
      networkPreferencesPort,
      ports: storePorts,
      networkDefaults: bootstrapPhase.networkPlan.preferencesDefaults,
      now: bootstrapPhase.storageNow,
    });

  const controllersInit = initControllers({
    bus: bootstrapPhase.bus,
    accountCodecs: bootstrapPhase.accountCodecs,
    accountsService: accountsStore,
    settingsService,
    permissionsService,
    transactionsService,
    networkPreferences,
    networkPlan: bootstrapPhase.networkPlan,
    options: bootstrapPhase.controllerOptions,
    ...(createApprovalExecutor ? { createApprovalExecutor } : {}),
  });

  const { controllersBase, networkController, chainDefinitionsController, deferredNetworkInitialState } =
    controllersInit;

  const chainViews = createChainViewsService({
    chainDefinitions: chainDefinitionsController,
    network: networkController,
    preferences: networkPreferences,
  });

  const chainActivation = createChainActivationService({
    network: networkController,
    preferences: networkPreferences,
    logger: bootstrapPhase.storageLogger,
  });

  const attention = createAttentionService({
    messenger: bootstrapPhase.bus.scope({ name: "attention", publish: ATTENTION_TOPICS }),
    now: bootstrapPhase.storageNow,
  });

  const runtimeLifecycle = createRuntimeLifecycle("createBackgroundRuntime");
  const sessionLayer = initSessionLayer({
    bus: bootstrapPhase.bus,
    controllers: controllersBase,
    accountsStore,
    keyringMetas,
    storageLogger: bootstrapPhase.storageLogger,
    storageNow: bootstrapPhase.storageNow,
    hydrationEnabled: bootstrapPhase.hydrationEnabled,
    getIsHydrating: () => runtimeLifecycle.getIsHydrating(),
    getIsDestroyed: () => runtimeLifecycle.getIsDestroyed(),
    ...(vaultMetaPort ? { vaultMetaPort } : {}),
    ...(bootstrapPhase.resolvedSessionOptions ? { sessionOptions: bootstrapPhase.resolvedSessionOptions } : {}),
  });

  const engine = initEngine(engineOptions);

  return {
    controllersBase,
    deferredNetworkInitialState,
    transactionRegistry: controllersInit.transactionRegistry,
    chainViews,
    chainActivation,
    attention,
    networkPreferences,
    sessionLayer,
    keyringService: sessionLayer.keyringService,
    runtimeLifecycle,
    engine,
    transactionsService,
  };
};

export const initializeRuntimeCapabilityPhase = ({
  bootstrapPhase,
  sessionPhase,
  rpcClientOptions,
}: {
  bootstrapPhase: RuntimeBootstrapPhase;
  sessionPhase: RuntimeSessionPhase;
  rpcClientOptions?: RpcLayerOptions;
}): RuntimeCapabilityPhase => {
  const rpcClientRegistry = initRpcLayer({
    controllers: sessionPhase.controllersBase,
    namespaceManifests: bootstrapPhase.namespaceManifests,
    ...(rpcClientOptions ? { rpcClientOptions } : {}),
  });

  const assembledRuntimeNamespaces = assembleRuntimeNamespaces({
    manifests: bootstrapPhase.namespaceManifests,
    transactionRegistry: sessionPhase.transactionRegistry,
    rpcClients: rpcClientRegistry,
    chains: bootstrapPhase.chainAddressCodecs,
    keyring: sessionPhase.keyringService,
  });

  const permissionViews = createPermissionViewsService({
    accounts: sessionPhase.controllersBase.accounts,
    permissions: sessionPhase.controllersBase.permissions,
  });

  const transactionsLifecycle = createTransactionsLifecycle({
    controller: sessionPhase.controllersBase.transactions,
    service: sessionPhase.transactionsService,
    unlock: sessionPhase.sessionLayer.session.unlock,
    logger: bootstrapPhase.storageLogger,
  });

  const networkBootstrap = createNetworkBootstrap({
    network: sessionPhase.controllersBase.network,
    chainDefinitions: sessionPhase.controllersBase.chainDefinitions,
    preferences: sessionPhase.networkPreferences,
    preferencesDefaults: bootstrapPhase.networkPlan.preferencesDefaults,
    hydrationEnabled: bootstrapPhase.hydrationEnabled,
    logger: bootstrapPhase.storageLogger,
    getIsHydrating: () => sessionPhase.runtimeLifecycle.getIsHydrating(),
    getRegisteredNamespaces: () => bootstrapPhase.registeredNamespaces,
  });

  return {
    rpcClientRegistry,
    signers: assembledRuntimeNamespaces.signers,
    namespaceBindings: assembledRuntimeNamespaces.bindings,
    permissionViews,
    transactionsLifecycle,
    networkBootstrap,
  };
};
