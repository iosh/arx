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
import type { RpcHandlerDeps } from "../../rpc/handlers/types.js";
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
import type { VaultMetaPort } from "../../storage/index.js";
import type { NamespaceTransactions } from "../../transactions/namespace/NamespaceTransactions.js";
import type { KeyringService } from "../keyring/KeyringService.js";
import {
  type BackgroundStateServiceOptions,
  type BackgroundStateServices,
  initBackgroundStateServices,
} from "./backgroundStateServices.js";
import { createNetworkBootstrap } from "./networkBootstrap.js";
import { buildRuntimeNetworkPlan, type RuntimeNetworkPlan } from "./networkDefaults.js";
import { initRpcLayer, type RpcLayerOptions } from "./rpcLayer.js";
import { createRuntimeLifecycle } from "./runtimeLifecycle.js";
import { initRuntimeStoreServices } from "./runtimeStoreServices.js";
import { initSessionLayer, type SessionLayerOptions, type SessionLayerResult, type SessionOptions } from "./session.js";

type StorageOptions = {
  vaultMetaPort?: VaultMetaPort;
  now?: () => number;
  hydrate?: boolean;
  logger?: (message: string, error?: unknown) => void;
};

type MessengerOptions = {
  violationMode?: ViolationMode;
};

export type BackgroundTransactionOptions = {
  namespaces?: NamespaceTransactions;
};

export type BackgroundAssemblyOptions = BackgroundStateServiceOptions & {
  transactions?: BackgroundTransactionOptions;
};

export type BackgroundBootstrapScope = {
  bus: Messenger;
  rpcRegistry: RpcRegistry;
  namespaceBootstrap: RuntimeBootstrapNamespaceAssembly;
  registeredNamespaces: ReadonlySet<string>;
  admittedChains: readonly ChainMetadata[];
  networkPlan: RuntimeNetworkPlan;
  storageLogger: (message: string, error?: unknown) => void;
  storageNow: () => number;
  hydrationEnabled: boolean;
  backgroundAssemblyOptions: BackgroundAssemblyOptions;
};

export type BackgroundSessionScope = {
  namespaceSession: RuntimeSessionNamespaceAssembly;
  stateServices: BackgroundStateServices;
  setApprovalExecutor: ReturnType<typeof initBackgroundStateServices>["setApprovalExecutor"];
  permissionsReady: Promise<void>;
  deferredNetworkInitialState: ReturnType<typeof initBackgroundStateServices>["deferredNetworkInitialState"];
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
};

export type BackgroundSupportScope = {
  namespaceTransactions: NamespaceTransactions;
  rpcClientRegistry: ReturnType<typeof initRpcLayer>;
  signers: RpcHandlerDeps["signers"];
  namespaceBindings: NamespaceRuntimeBindingsRegistry;
  namespaceRuntimeSupport: NamespaceRuntimeSupportIndex;
  permissionViews: ReturnType<typeof createPermissionViewsService>;
  networkBootstrap: ReturnType<typeof createNetworkBootstrap>;
};

const extractSessionLayerOptions = (sessionOptions?: SessionOptions): SessionLayerOptions | undefined => {
  if (!sessionOptions) {
    return undefined;
  }

  const { keyringNamespaces: _keyringNamespaces, ...resolvedSessionOptions } = sessionOptions;
  return Object.keys(resolvedSessionOptions).length > 0 ? resolvedSessionOptions : undefined;
};

export const createBackgroundBootstrapScope = ({
  rpcRegistry,
  namespaceBootstrap,
  messengerOptions,
  storageOptions,
  networkOptions,
  approvalOptions,
  transactionOptions,
  supportedChainsOptions,
}: {
  rpcRegistry: RpcRegistry;
  namespaceBootstrap: RuntimeBootstrapNamespaceAssembly;
  messengerOptions?: MessengerOptions;
  storageOptions?: StorageOptions;
  networkOptions?: BackgroundAssemblyOptions["network"];
  approvalOptions?: BackgroundAssemblyOptions["approvals"];
  transactionOptions?: BackgroundAssemblyOptions["transactions"];
  supportedChainsOptions: NonNullable<BackgroundAssemblyOptions["supportedChains"]>;
}): BackgroundBootstrapScope => {
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

  const backgroundAssemblyOptions: BackgroundAssemblyOptions = {
    ...(networkOptions ? { network: networkOptions } : {}),
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
    backgroundAssemblyOptions,
  };
};

export const createBackgroundSessionScope = ({
  lifecycleLabel,
  bootstrapScope,
  namespaceSession,
  settingsPort,
  networkSelectionPort,
  customRpcPort,
  storePorts,
  vaultMetaPort,
  sessionOptions,
}: {
  lifecycleLabel?: string;
  bootstrapScope: BackgroundBootstrapScope;
  namespaceSession: RuntimeSessionNamespaceAssembly;
  settingsPort: SettingsPort;
  networkSelectionPort: NetworkSelectionPort;
  customRpcPort: CustomRpcPort;
  storePorts: {
    accounts: AccountsPort;
    keyringMetas: KeyringMetasPort;
    permissions: PermissionsPort;
  };
  vaultMetaPort?: VaultMetaPort;
  sessionOptions?: SessionOptions;
}): BackgroundSessionScope => {
  const { settingsService, networkSelection, customRpc, accountsStore, keyringMetas } = initRuntimeStoreServices({
    settingsPort,
    networkSelectionPort,
    customRpcPort,
    ports: storePorts,
    selectionDefaults: bootstrapScope.networkPlan.selectionDefaults,
    now: bootstrapScope.storageNow,
  });

  const stateServicesInit = initBackgroundStateServices({
    bus: bootstrapScope.bus,
    accountCodecs: bootstrapScope.namespaceBootstrap.accountCodecs,
    accountsService: accountsStore,
    settingsService,
    permissionsPort: storePorts.permissions,
    networkPlan: bootstrapScope.networkPlan,
    options: bootstrapScope.backgroundAssemblyOptions,
  });

  const {
    stateServices,
    setApprovalExecutor,
    rpcRoutingService,
    supportedChainsService,
    permissionsReady,
    deferredNetworkInitialState,
  } = stateServicesInit;

  const chainViews = createChainViewsService({
    supportedChains: supportedChainsService,
    network: rpcRoutingService,
    selection: networkSelection,
  });

  const chainActivation = createChainActivationService({
    network: rpcRoutingService,
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

  return {
    namespaceSession,
    stateServices,
    setApprovalExecutor,
    permissionsReady,
    deferredNetworkInitialState,
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
  };
};

export const createBackgroundSupportScope = ({
  bootstrapScope,
  sessionScope,
  namespaceRuntimeSupport,
  rpcClientOptions,
  createApprovalExecutor,
}: {
  bootstrapScope: BackgroundBootstrapScope;
  sessionScope: BackgroundSessionScope;
  namespaceRuntimeSupport: RuntimeNamespaceRuntimeSupportAssembly;
  rpcClientOptions?: RpcLayerOptions;
  createApprovalExecutor?: (params: { stateServices: BackgroundStateServices }) => ApprovalExecutor | undefined;
}): BackgroundSupportScope => {
  const manifestRpcClientFactories = namespaceRuntimeSupport.namespaces.flatMap((spec) =>
    spec.clientFactory ? [{ namespace: spec.namespace, factory: spec.clientFactory }] : [],
  );
  const overrideRpcClientFactories = rpcClientOptions?.factories ?? [];
  const rpcClientFactoryNamespaces = new Set(
    [...manifestRpcClientFactories, ...overrideRpcClientFactories].map((entry) => entry.namespace),
  );
  const rpcClientRegistry = initRpcLayer({
    stateServices: sessionScope.stateServices,
    ...(rpcClientOptions?.options ? { rpcClientOptions: { options: rpcClientOptions.options } } : {}),
    factories: [...manifestRpcClientFactories, ...overrideRpcClientFactories],
  });

  const materializedRuntimeSupport = materializeNamespaceRuntimeSupport({
    runtimeSupport: namespaceRuntimeSupport,
    rpcClients: rpcClientRegistry,
    chains: bootstrapScope.namespaceBootstrap.chainAddressCodecs,
    accountSigning: sessionScope.accountSigning,
    rpcClientNamespaces: rpcClientFactoryNamespaces,
    ...(bootstrapScope.backgroundAssemblyOptions.transactions?.namespaces
      ? { transactionOverrides: bootstrapScope.backgroundAssemblyOptions.transactions.namespaces }
      : {}),
  });
  const namespaceTransactions = materializedRuntimeSupport.namespaceTransactions;

  const approvalExecutor = createApprovalExecutor?.({
    stateServices: sessionScope.stateServices,
  });
  sessionScope.setApprovalExecutor(approvalExecutor);
  // Approval execution is wired after namespace bindings exist, so decisions
  // observe fully materialized namespace-specific approval support.

  const permissionViews = createPermissionViewsService({
    accounts: sessionScope.stateServices.accounts,
    permissions: sessionScope.stateServices.permissions,
  });

  const networkBootstrap = createNetworkBootstrap({
    network: sessionScope.stateServices.network,
    supportedChains: sessionScope.stateServices.supportedChains,
    selection: sessionScope.networkSelection,
    customRpc: sessionScope.customRpc,
    selectionDefaults: bootstrapScope.networkPlan.selectionDefaults,
    hydrationEnabled: bootstrapScope.hydrationEnabled,
    logger: bootstrapScope.storageLogger,
    getIsHydrating: () => sessionScope.runtimeLifecycle.getIsHydrating(),
    getRegisteredNamespaces: () => bootstrapScope.registeredNamespaces,
  });

  return {
    namespaceTransactions,
    rpcClientRegistry,
    signers: materializedRuntimeSupport.signers,
    namespaceBindings: materializedRuntimeSupport.bindings,
    namespaceRuntimeSupport: materializedRuntimeSupport.runtimeSupport,
    permissionViews,
    networkBootstrap,
  };
};
