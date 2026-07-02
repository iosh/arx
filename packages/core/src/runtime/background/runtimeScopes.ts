import type { ApprovalExecutor } from "../../approvals/types.js";
import { getChainRefNamespace } from "../../chains/caip.js";
import type { ChainDefinitionSeed } from "../../chains/definition.js";
import type { RpcEndpoint } from "../../chains/metadata.js";
import type { ChainRpcAccessUpdater } from "../../chains/rpc/types.js";
import { createMessenger, type Messenger } from "../../messenger/index.js";
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
import { createAttentionService } from "../../services/runtime/attention/index.js";
import { createChainActivationService } from "../../services/runtime/chainActivation/index.js";
import { createChainViewsService } from "../../services/runtime/chainViews/index.js";
import { createKeyringExportService, type KeyringExportService } from "../../services/runtime/keyringExport.js";
import { createPermissionViewsService } from "../../services/runtime/permissionViews/index.js";
import { createSessionStatusService, type SessionStatusService } from "../../services/runtime/sessionStatus.js";
import type { AccountsPort } from "../../services/store/accounts/port.js";
import type { ChainRpcDefaultEndpointsPort } from "../../services/store/chainRpcDefaultEndpoints/port.js";
import type { ChainRpcDefaultEndpointsService } from "../../services/store/chainRpcDefaultEndpoints/types.js";
import type { ChainRpcEndpointOverridesPort } from "../../services/store/chainRpcEndpointOverrides/port.js";
import type { ChainRpcEndpointOverridesService } from "../../services/store/chainRpcEndpointOverrides/types.js";
import type { KeyringMetasPort } from "../../services/store/keyringMetas/port.js";
import type { PermissionsPort } from "../../services/store/permissions/port.js";
import type { ProviderChainSelectionPort } from "../../services/store/providerChainSelection/port.js";
import type { ProviderChainSelectionService } from "../../services/store/providerChainSelection/types.js";
import type { SettingsPort } from "../../services/store/settings/port.js";
import type { WalletChainSelectionPort } from "../../services/store/walletChainSelection/port.js";
import type { WalletChainSelectionService } from "../../services/store/walletChainSelection/types.js";
import type { VaultMetaPort } from "../../storage/index.js";
import type { NamespaceTransactions } from "../../transactions/namespace/NamespaceTransactions.js";
import type { KeyringService } from "../keyring/KeyringService.js";
import {
  type BackgroundStateServiceOptions,
  type BackgroundStateServices,
  initBackgroundStateServices,
} from "./backgroundStateServices.js";
import { createChainRpcBootstrap } from "./chainRpcBootstrap.js";
import { buildRuntimeChainAdmission, type RuntimeChainAdmission } from "./chainRpcDefaults.js";
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

export type BackgroundTransactionOptions = {
  namespaces?: NamespaceTransactions;
};

export type BackgroundAssemblyOptions = BackgroundStateServiceOptions & {
  transactions?: BackgroundTransactionOptions;
};

export type BackgroundBootstrapScope = {
  messenger: Messenger;
  rpcRegistry: RpcRegistry;
  namespaceBootstrap: RuntimeBootstrapNamespaceAssembly;
  registeredNamespaces: ReadonlySet<string>;
  admittedChainSeeds: readonly ChainDefinitionSeed<RpcEndpoint>[];
  chainAdmission: RuntimeChainAdmission;
  storageLogger: (message: string, error?: unknown) => void;
  storageNow: () => number;
  hydrationEnabled: boolean;
  backgroundAssemblyOptions: BackgroundAssemblyOptions;
};

export type BackgroundSessionScope = {
  namespaceSession: RuntimeSessionNamespaceAssembly;
  stateServices: BackgroundStateServices;
  chainRpcAccessUpdater: ChainRpcAccessUpdater;
  setApprovalExecutor: ReturnType<typeof initBackgroundStateServices>["setApprovalExecutor"];
  permissionsReady: Promise<void>;
  chainViews: ReturnType<typeof createChainViewsService>;
  chainActivation: ReturnType<typeof createChainActivationService>;
  attention: ReturnType<typeof createAttentionService>;
  settingsService: ReturnType<typeof initRuntimeStoreServices>["settingsService"];
  walletChainSelection: WalletChainSelectionService;
  providerChainSelection: ProviderChainSelectionService;
  chainRpcDefaultEndpoints: ChainRpcDefaultEndpointsService;
  chainRpcEndpointOverrides: ChainRpcEndpointOverridesService;
  sessionLayer: SessionLayerResult;
  sessionStatus: SessionStatusService;
  accountSigning: AccountSigningService;
  keyringExport: KeyringExportService;
  keyringService: KeyringService;
  runtimeLifecycle: ReturnType<typeof createRuntimeLifecycle>;
};

export type BackgroundSupportScope = {
  namespaceTransactions: NamespaceTransactions;
  chainRpcClientPool: ReturnType<typeof initRpcLayer>;
  signers: RpcHandlerDeps["signers"];
  namespaceBindings: NamespaceRuntimeBindingsRegistry;
  namespaceRuntimeSupport: NamespaceRuntimeSupportIndex;
  permissionViews: ReturnType<typeof createPermissionViewsService>;
  chainRpcBootstrap: ReturnType<typeof createChainRpcBootstrap>;
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
  storageOptions,
  approvalOptions,
  transactionOptions,
  supportedChainsOptions,
}: {
  rpcRegistry: RpcRegistry;
  namespaceBootstrap: RuntimeBootstrapNamespaceAssembly;
  storageOptions?: StorageOptions;
  approvalOptions?: BackgroundAssemblyOptions["approvals"];
  transactionOptions?: BackgroundAssemblyOptions["transactions"];
  supportedChainsOptions: NonNullable<BackgroundAssemblyOptions["supportedChains"]>;
}): BackgroundBootstrapScope => {
  registerRpcModules(rpcRegistry, namespaceBootstrap.rpcModules);

  const storageLogger = storageOptions?.logger ?? (() => {});
  const messenger = createMessenger();
  const registeredNamespaces = new Set(rpcRegistry.getRegisteredNamespaces());
  const supportedChainSeed = supportedChainsOptions.seed ?? namespaceBootstrap.chainSeeds;
  const chainAdmission = buildRuntimeChainAdmission({
    admittedChainSeeds: supportedChainSeed.filter((entry) =>
      registeredNamespaces.has(getChainRefNamespace(entry.definition.chainRef)),
    ),
  });

  const storageNow = storageOptions?.now ?? Date.now;
  const hydrationEnabled = storageOptions?.hydrate ?? true;

  const backgroundAssemblyOptions: BackgroundAssemblyOptions = {
    ...(approvalOptions ? { approvals: { ...approvalOptions, logger: approvalOptions.logger ?? storageLogger } } : {}),
    ...(transactionOptions ? { transactions: transactionOptions } : {}),
    supportedChains: { ...supportedChainsOptions, seed: [...supportedChainSeed] },
  };

  return {
    messenger,
    rpcRegistry,
    namespaceBootstrap,
    registeredNamespaces,
    admittedChainSeeds: chainAdmission.admittedChainSeeds,
    chainAdmission,
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
  walletChainSelectionPort,
  providerChainSelectionPort,
  chainRpcDefaultEndpointsPort,
  chainRpcEndpointOverridesPort,
  storePorts,
  vaultMetaPort,
  sessionOptions,
}: {
  lifecycleLabel?: string;
  bootstrapScope: BackgroundBootstrapScope;
  namespaceSession: RuntimeSessionNamespaceAssembly;
  settingsPort: SettingsPort;
  walletChainSelectionPort: WalletChainSelectionPort;
  providerChainSelectionPort: ProviderChainSelectionPort;
  chainRpcDefaultEndpointsPort: ChainRpcDefaultEndpointsPort;
  chainRpcEndpointOverridesPort: ChainRpcEndpointOverridesPort;
  storePorts: {
    accounts: AccountsPort;
    keyringMetas: KeyringMetasPort;
    permissions: PermissionsPort;
  };
  vaultMetaPort?: VaultMetaPort;
  sessionOptions?: SessionOptions;
}): BackgroundSessionScope => {
  const {
    settingsService,
    walletChainSelection,
    providerChainSelection,
    chainRpcDefaultEndpoints,
    chainRpcEndpointOverrides,
    accountsStore,
    keyringMetas,
  } = initRuntimeStoreServices({
    messenger: bootstrapScope.messenger,
    settingsPort,
    walletChainSelectionPort,
    providerChainSelectionPort,
    chainRpcDefaultEndpointsPort,
    chainRpcEndpointOverridesPort,
    ports: storePorts,
    selectionDefaults: bootstrapScope.chainAdmission.selectionDefaults,
    now: bootstrapScope.storageNow,
  });

  const stateServicesInit = initBackgroundStateServices({
    messenger: bootstrapScope.messenger,
    accountCodecs: bootstrapScope.namespaceBootstrap.accountCodecs,
    accountsService: accountsStore,
    settingsService,
    permissionsPort: storePorts.permissions,
    options: bootstrapScope.backgroundAssemblyOptions,
  });

  const { stateServices, setApprovalExecutor, chainRpcAccessUpdater, supportedChainsService, permissionsReady } =
    stateServicesInit;

  const chainViews = createChainViewsService({
    supportedChains: supportedChainsService,
    chainRpc: stateServices.chainRpc,
    selection: walletChainSelection,
  });

  const chainActivation = createChainActivationService({
    chainRpc: stateServices.chainRpc,
    walletChainSelection,
    providerChainSelection,
    logger: bootstrapScope.storageLogger,
  });

  const attention = createAttentionService({
    messenger: bootstrapScope.messenger,
    now: bootstrapScope.storageNow,
  });

  const runtimeLifecycle = createRuntimeLifecycle(lifecycleLabel ?? "createBackgroundRuntime");
  const resolvedKeyringNamespaces = sessionOptions?.keyringNamespaces ?? namespaceSession.keyringNamespaces;
  const resolvedSessionOptions = extractSessionLayerOptions(sessionOptions);
  const sessionLayer = initSessionLayer({
    messenger: bootstrapScope.messenger,
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
    chainRpcAccessUpdater,
    setApprovalExecutor,
    permissionsReady,
    chainViews,
    chainActivation,
    attention,
    settingsService,
    walletChainSelection,
    providerChainSelection,
    chainRpcDefaultEndpoints,
    chainRpcEndpointOverrides,
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
  const chainRpcClientPool = initRpcLayer({
    stateServices: sessionScope.stateServices,
    ...(rpcClientOptions?.options ? { rpcClientOptions: { options: rpcClientOptions.options } } : {}),
    factories: [...manifestRpcClientFactories, ...overrideRpcClientFactories],
  });

  const materializedRuntimeSupport = materializeNamespaceRuntimeSupport({
    runtimeSupport: namespaceRuntimeSupport,
    rpcClients: chainRpcClientPool,
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

  const chainRpcBootstrap = createChainRpcBootstrap({
    chainRpcAccessUpdater: sessionScope.chainRpcAccessUpdater,
    supportedChains: sessionScope.stateServices.supportedChains,
    selection: sessionScope.walletChainSelection,
    defaultEndpoints: sessionScope.chainRpcDefaultEndpoints,
    defaultEndpointSeeds: bootstrapScope.chainAdmission.admittedChainSeeds.flatMap((seed) =>
      seed.defaultRpcEndpoints
        ? [
            {
              chainRef: seed.definition.chainRef,
              rpcEndpoints: seed.defaultRpcEndpoints,
              source: "bundle",
            },
          ]
        : [],
    ),
    endpointOverrides: sessionScope.chainRpcEndpointOverrides,
    selectionDefaults: bootstrapScope.chainAdmission.selectionDefaults,
    hydrationEnabled: bootstrapScope.hydrationEnabled,
    logger: bootstrapScope.storageLogger,
    getIsHydrating: () => sessionScope.runtimeLifecycle.getIsHydrating(),
    getRegisteredNamespaces: () => bootstrapScope.registeredNamespaces,
  });

  return {
    namespaceTransactions,
    chainRpcClientPool,
    signers: materializedRuntimeSupport.signers,
    namespaceBindings: materializedRuntimeSupport.bindings,
    namespaceRuntimeSupport: materializedRuntimeSupport.runtimeSupport,
    permissionViews,
    chainRpcBootstrap,
  };
};
