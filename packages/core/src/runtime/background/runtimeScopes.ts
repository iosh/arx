import type { ApprovalExecutor } from "../../approvals/types.js";
import type { ChainMetadata } from "../../chains/metadata.js";
import { Messenger, type ViolationMode } from "../../messenger/Messenger.js";
import {
  materializeNamespaceRuntimeSupport,
  type NamespaceRuntimeBindingsRegistry,
  type NamespaceRuntimeSupportIndex,
  type RuntimeBootstrapNamespaceAssembly,
  type RuntimeNamespaceRuntimeSupportAssembly,
  type RuntimeSessionNamespaceAssembly,
  registerRpcModules,
} from "../../namespaces/index.js";
import type { HandlerControllers } from "../../rpc/handlers/types.js";
import type { RpcRegistry } from "../../rpc/index.js";
import { type AccountSigningService, createAccountSigningService } from "../../services/runtime/accountSigning.js";
import { ATTENTION_TOPICS, createAttentionService } from "../../services/runtime/attention/index.js";
import { createChainActivationService } from "../../services/runtime/chainActivation/index.js";
import { createChainViewsService } from "../../services/runtime/chainViews/index.js";
import { createKeyringExportService, type KeyringExportService } from "../../services/runtime/keyringExport.js";
import { createPermissionViewsService } from "../../services/runtime/permissionViews/index.js";
import { createSessionStatusService, type SessionStatusService } from "../../services/runtime/sessionStatus.js";
import type { AccountsPort } from "../../services/store/accounts/port.js";
import type { CustomRpcPort } from "../../services/store/customRpc/port.js";
import type { CustomRpcService } from "../../services/store/customRpc/types.js";
import type { KeyringMetasPort } from "../../services/store/keyringMetas/port.js";
import type { NetworkSelectionPort } from "../../services/store/networkSelection/port.js";
import type { NetworkSelectionService } from "../../services/store/networkSelection/types.js";
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
import { initSessionLayer, type SessionLayerOptions, type SessionLayerResult, type SessionOptions } from "./session.js";
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

export type RuntimeBootstrapScope = {
  bus: Messenger;
  rpcRegistry: RpcRegistry;
  namespaceBootstrap: RuntimeBootstrapNamespaceAssembly;
  registeredNamespaces: ReadonlySet<string>;
  admittedChains: readonly ChainMetadata[];
  networkPlan: RuntimeNetworkPlan;
  storageLogger: (message: string, error?: unknown) => void;
  storageNow: () => number;
  hydrationEnabled: boolean;
  controllerOptions: ControllerLayerOptions;
};

export type RuntimeSessionScope = {
  namespaceSession: RuntimeSessionNamespaceAssembly;
  controllersBase: ControllersBase;
  permissionsReady: Promise<void>;
  deferredNetworkInitialState: ReturnType<typeof initControllers>["deferredNetworkInitialState"];
  namespaceTransactions: ReturnType<typeof initControllers>["namespaceTransactions"];
  chainViews: ReturnType<typeof createChainViewsService>;
  chainActivation: ReturnType<typeof createChainActivationService>;
  attention: ReturnType<typeof createAttentionService>;
  networkSelection: NetworkSelectionService;
  customRpc: CustomRpcService;
  sessionLayer: SessionLayerResult;
  sessionStatus: SessionStatusService;
  accountSigning: AccountSigningService;
  keyringExport: KeyringExportService;
  keyringService: KeyringService;
  runtimeLifecycle: ReturnType<typeof createRuntimeLifecycle>;
  engine: ReturnType<typeof initEngine>;
  transactionsService: ReturnType<typeof initRuntimeStoreServices>["transactionsService"];
};

export type RuntimeSupportScope = {
  rpcClientRegistry: ReturnType<typeof initRpcLayer>;
  signers: HandlerControllers["signers"];
  namespaceBindings: NamespaceRuntimeBindingsRegistry;
  namespaceRuntimeSupport: NamespaceRuntimeSupportIndex;
  permissionViews: ReturnType<typeof createPermissionViewsService>;
  transactionsLifecycle: ReturnType<typeof createTransactionsLifecycle>;
  networkBootstrap: ReturnType<typeof createNetworkBootstrap>;
};

const extractSessionLayerOptions = (sessionOptions?: SessionOptions): SessionLayerOptions | undefined => {
  if (!sessionOptions) {
    return undefined;
  }

  const { keyringNamespaces: _keyringNamespaces, ...resolvedSessionOptions } = sessionOptions;
  return Object.keys(resolvedSessionOptions).length > 0 ? resolvedSessionOptions : undefined;
};

export const createRuntimeBootstrapScope = ({
  rpcRegistry,
  namespaceBootstrap,
  messengerOptions,
  storageOptions,
  networkOptions,
  accountOptions,
  approvalOptions,
  transactionOptions,
  supportedChainsOptions,
}: {
  rpcRegistry: RpcRegistry;
  namespaceBootstrap: RuntimeBootstrapNamespaceAssembly;
  messengerOptions?: MessengerOptions;
  storageOptions?: StorageOptions;
  networkOptions?: ControllerLayerOptions["network"];
  accountOptions?: ControllerLayerOptions["accounts"];
  approvalOptions?: ControllerLayerOptions["approvals"];
  transactionOptions?: ControllerLayerOptions["transactions"];
  supportedChainsOptions: NonNullable<ControllerLayerOptions["supportedChains"]>;
}): RuntimeBootstrapScope => {
  registerRpcModules(rpcRegistry, namespaceBootstrap.rpcModules);

  const storageLogger = storageOptions?.logger ?? (() => {});
  const bus = new Messenger({
    violationMode: messengerOptions?.violationMode ?? "throw",
    onListenerError: ({ topic, error }) => storageLogger(`messenger: listener error in "${topic}"`, error),
    onViolation: (info) => storageLogger(`messenger: violation(${info.kind}) "${info.topic}"`, info),
  });
  const registeredNamespaces = new Set(rpcRegistry.getRegisteredNamespaces());
  const supportedChainSeed = supportedChainsOptions.seed ?? namespaceBootstrap.chainSeeds;
  const networkPlan = buildRuntimeNetworkPlan({
    admittedChains: supportedChainSeed.filter((entry) => registeredNamespaces.has(entry.namespace)),
    ...(networkOptions?.initialState ? { requestedInitialState: networkOptions.initialState } : {}),
    ...(networkOptions?.defaultStrategy ? { defaultStrategy: networkOptions.defaultStrategy } : {}),
  });

  const storageNow = storageOptions?.now ?? Date.now;
  const hydrationEnabled = storageOptions?.hydrate ?? true;

  const controllerOptions: ControllerLayerOptions = {
    ...(networkOptions ? { network: networkOptions } : {}),
    ...(accountOptions ? { accounts: accountOptions } : {}),
    ...(approvalOptions ? { approvals: { ...approvalOptions, logger: approvalOptions.logger ?? storageLogger } } : {}),
    ...(transactionOptions ? { transactions: transactionOptions } : {}),
    supportedChains: { ...supportedChainsOptions, seed: [...supportedChainSeed] },
  };

  return {
    bus,
    rpcRegistry,
    namespaceBootstrap,
    registeredNamespaces,
    admittedChains: networkPlan.admittedChains,
    networkPlan,
    storageLogger,
    storageNow,
    hydrationEnabled,
    controllerOptions,
  };
};

export const createRuntimeSessionScope = ({
  lifecycleLabel,
  bootstrapScope,
  namespaceSession,
  settingsPort,
  networkSelectionPort,
  customRpcPort,
  storePorts,
  engineOptions,
  vaultMetaPort,
  createApprovalExecutor,
  sessionOptions,
}: {
  lifecycleLabel?: string;
  bootstrapScope: RuntimeBootstrapScope;
  namespaceSession: RuntimeSessionNamespaceAssembly;
  settingsPort: SettingsPort;
  networkSelectionPort: NetworkSelectionPort;
  customRpcPort: CustomRpcPort;
  storePorts: {
    transactions: TransactionsPort;
    accounts: AccountsPort;
    keyringMetas: KeyringMetasPort;
    permissions: PermissionsPort;
  };
  engineOptions?: EngineOptions;
  vaultMetaPort?: VaultMetaPort;
  createApprovalExecutor?: (controllersBase: ControllersBase) => ApprovalExecutor | undefined;
  sessionOptions?: SessionOptions;
}): RuntimeSessionScope => {
  const { settingsService, networkSelection, customRpc, transactionsService, accountsStore, keyringMetas } =
    initRuntimeStoreServices({
      settingsPort,
      networkSelectionPort,
      customRpcPort,
      ports: storePorts,
      selectionDefaults: bootstrapScope.networkPlan.selectionDefaults,
      now: bootstrapScope.storageNow,
    });

  const controllersInit = initControllers({
    bus: bootstrapScope.bus,
    accountCodecs: bootstrapScope.namespaceBootstrap.accountCodecs,
    accountsService: accountsStore,
    settingsService,
    permissionsPort: storePorts.permissions,
    transactionsService,
    networkSelection,
    networkPlan: bootstrapScope.networkPlan,
    options: bootstrapScope.controllerOptions,
    ...(createApprovalExecutor ? { createApprovalExecutor } : {}),
  });

  const {
    controllersBase,
    networkController,
    supportedChainsController,
    permissionsReady,
    deferredNetworkInitialState,
  } = controllersInit;

  const chainViews = createChainViewsService({
    supportedChains: supportedChainsController,
    network: networkController,
    selection: networkSelection,
  });

  const chainActivation = createChainActivationService({
    network: networkController,
    networkSelection,
    logger: bootstrapScope.storageLogger,
  });

  const attention = createAttentionService({
    messenger: bootstrapScope.bus.scope({ name: "attention", publish: ATTENTION_TOPICS }),
    now: bootstrapScope.storageNow,
  });

  const runtimeLifecycle = createRuntimeLifecycle(lifecycleLabel ?? "createBackgroundRuntime");
  const resolvedKeyringNamespaces = sessionOptions?.keyringNamespaces ?? namespaceSession.keyringNamespaces;
  const resolvedSessionOptions = extractSessionLayerOptions(sessionOptions);
  const sessionLayer = initSessionLayer({
    bus: bootstrapScope.bus,
    controllers: controllersBase,
    accountsStore,
    keyringMetas,
    keyringNamespaces: resolvedKeyringNamespaces,
    storageLogger: bootstrapScope.storageLogger,
    storageNow: bootstrapScope.storageNow,
    hydrationEnabled: bootstrapScope.hydrationEnabled,
    getIsHydrating: () => runtimeLifecycle.getIsHydrating(),
    getIsDestroyed: () => runtimeLifecycle.getIsDestroyed(),
    ...(vaultMetaPort ? { vaultMetaPort } : {}),
    ...(resolvedSessionOptions ? { sessionOptions: resolvedSessionOptions } : {}),
  });
  const sessionStatus = createSessionStatusService({
    unlock: sessionLayer.session.unlock,
    vault: sessionLayer.session.vault,
  });
  const accountSigning = createAccountSigningService({
    keyring: sessionLayer.keyringService,
  });
  const keyringExport = createKeyringExportService({
    sessionStatus,
    keyring: sessionLayer.keyringService,
  });

  const engine = initEngine(engineOptions);

  return {
    namespaceSession,
    controllersBase,
    permissionsReady,
    deferredNetworkInitialState,
    namespaceTransactions: controllersInit.namespaceTransactions,
    chainViews,
    chainActivation,
    attention,
    networkSelection,
    customRpc,
    sessionLayer,
    sessionStatus,
    accountSigning,
    keyringExport,
    keyringService: sessionLayer.keyringService,
    runtimeLifecycle,
    engine,
    transactionsService,
  };
};

export const createRuntimeSupportScope = ({
  bootstrapScope,
  sessionScope,
  namespaceRuntimeSupport,
  rpcClientOptions,
}: {
  bootstrapScope: RuntimeBootstrapScope;
  sessionScope: RuntimeSessionScope;
  namespaceRuntimeSupport: RuntimeNamespaceRuntimeSupportAssembly;
  rpcClientOptions?: RpcLayerOptions;
}): RuntimeSupportScope => {
  const manifestRpcClientFactories = namespaceRuntimeSupport.namespaces.flatMap((spec) =>
    spec.clientFactory ? [{ namespace: spec.namespace, factory: spec.clientFactory }] : [],
  );
  const overrideRpcClientFactories = rpcClientOptions?.factories ?? [];
  const rpcClientFactoryNamespaces = new Set(
    [...manifestRpcClientFactories, ...overrideRpcClientFactories].map((entry) => entry.namespace),
  );
  const rpcClientRegistry = initRpcLayer({
    controllers: sessionScope.controllersBase,
    ...(rpcClientOptions?.options ? { rpcClientOptions: { options: rpcClientOptions.options } } : {}),
    factories: [...manifestRpcClientFactories, ...overrideRpcClientFactories],
  });

  const materializedRuntimeSupport = materializeNamespaceRuntimeSupport({
    runtimeSupport: namespaceRuntimeSupport,
    namespaceTransactions: sessionScope.namespaceTransactions,
    rpcClients: rpcClientRegistry,
    chains: bootstrapScope.namespaceBootstrap.chainAddressCodecs,
    accountSigning: sessionScope.accountSigning,
    rpcClientNamespaces: rpcClientFactoryNamespaces,
  });

  const permissionViews = createPermissionViewsService({
    accounts: sessionScope.controllersBase.accounts,
    permissions: sessionScope.controllersBase.permissions,
  });

  const transactionsLifecycle = createTransactionsLifecycle({
    controller: sessionScope.controllersBase.transactions,
    service: sessionScope.transactionsService,
    unlock: sessionScope.sessionLayer.session.unlock,
    logger: bootstrapScope.storageLogger,
  });

  const networkBootstrap = createNetworkBootstrap({
    network: sessionScope.controllersBase.network,
    supportedChains: sessionScope.controllersBase.supportedChains,
    selection: sessionScope.networkSelection,
    customRpc: sessionScope.customRpc,
    selectionDefaults: bootstrapScope.networkPlan.selectionDefaults,
    hydrationEnabled: bootstrapScope.hydrationEnabled,
    logger: bootstrapScope.storageLogger,
    getIsHydrating: () => sessionScope.runtimeLifecycle.getIsHydrating(),
    getRegisteredNamespaces: () => bootstrapScope.registeredNamespaces,
  });

  return {
    rpcClientRegistry,
    signers: materializedRuntimeSupport.signers,
    namespaceBindings: materializedRuntimeSupport.bindings,
    namespaceRuntimeSupport: materializedRuntimeSupport.runtimeSupport,
    permissionViews,
    transactionsLifecycle,
    networkBootstrap,
  };
};
