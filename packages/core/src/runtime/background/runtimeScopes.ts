import { getChainRefNamespace } from "../../chains/caip.js";
import type { ChainDefinitionSeed, RpcEndpoint } from "../../chains/definition.js";
import type { ChainRpcAccessUpdater } from "../../chains/rpc/types.js";
import { createMessenger, type Messenger } from "../../messenger/index.js";
import {
  materializeNamespaceRuntime,
  type NamespaceRuntimeServices,
  type NamespaceStaticAssembly,
} from "../../namespaces/index.js";
import { listRpcNamespaces } from "../../rpc/index.js";
import { type AccountSigningService, createAccountSigningService } from "../../keyring/accountSigning.js";
import { createAttentionService } from "../../wallet/attention/index.js";
import { createChainActivationService } from "../../chains/activation/index.js";
import { createChainViewsService } from "../../chains/views/index.js";
import { createPermissionViewsService } from "../../permissions/views/index.js";
import type { AccountsPort } from "../../accounts/accountsPort.js";
import type { ChainRpcDefaultEndpointsPort } from "../../chains/rpc/defaultEndpoints/port.js";
import type { ChainRpcDefaultEndpointsService } from "../../chains/rpc/defaultEndpoints/types.js";
import type { ChainRpcEndpointOverridesPort } from "../../chains/rpc/endpointOverrides/port.js";
import type { ChainRpcEndpointOverridesService } from "../../chains/rpc/endpointOverrides/types.js";
import type { KeyringMetasPort } from "../../keyring/keyringMetasPort.js";
import type { PermissionsPort } from "../../permissions/service/port.js";
import type { ProviderChainSelectionPort } from "../../chains/selection/provider/port.js";
import type { ProviderChainSelectionService } from "../../chains/selection/provider/types.js";
import type { WalletChainSelectionPort } from "../../chains/selection/wallet/port.js";
import type { WalletChainSelectionService } from "../../chains/selection/wallet/types.js";
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
  namespaceBootstrap: NamespaceStaticAssembly;
  registeredNamespaces: ReadonlySet<string>;
  admittedChainSeeds: readonly ChainDefinitionSeed<RpcEndpoint>[];
  chainAdmission: RuntimeChainAdmission;
  storageLogger: (message: string, error?: unknown) => void;
  storageNow: () => number;
  hydrationEnabled: boolean;
  backgroundAssemblyOptions: BackgroundAssemblyOptions;
};

export type BackgroundSessionScope = {
  stateServices: BackgroundStateServices;
  chainRpcAccessUpdater: ChainRpcAccessUpdater;
  permissionsReady: Promise<void>;
  chainViews: ReturnType<typeof createChainViewsService>;
  chainActivation: ReturnType<typeof createChainActivationService>;
  attention: ReturnType<typeof createAttentionService>;
  walletChainSelection: WalletChainSelectionService;
  providerChainSelection: ProviderChainSelectionService;
  chainRpcDefaultEndpoints: ChainRpcDefaultEndpointsService;
  chainRpcEndpointOverrides: ChainRpcEndpointOverridesService;
  sessionLayer: SessionLayerResult;
  accountSigning: AccountSigningService;
  keyringService: KeyringService;
  runtimeLifecycle: ReturnType<typeof createRuntimeLifecycle>;
};

export type BackgroundSupportScope = {
  namespaceTransactions: NamespaceTransactions;
  chainRpcClientPool: ReturnType<typeof initRpcLayer>;
  namespaceRuntime: NamespaceRuntimeServices;
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
  namespaceBootstrap,
  storageOptions,
  approvalOptions,
  transactionOptions,
  chainDefinitionsOptions,
}: {
  namespaceBootstrap: NamespaceStaticAssembly;
  storageOptions?: StorageOptions;
  approvalOptions?: BackgroundAssemblyOptions["approvals"];
  transactionOptions?: BackgroundAssemblyOptions["transactions"];
  chainDefinitionsOptions: NonNullable<BackgroundAssemblyOptions["chainDefinitions"]>;
}): BackgroundBootstrapScope => {
  const storageLogger = storageOptions?.logger ?? (() => {});
  const messenger = createMessenger();
  const registeredNamespaces = new Set(listRpcNamespaces(namespaceBootstrap.rpcRouting));
  const chainDefinitionSeed = chainDefinitionsOptions.seed ?? namespaceBootstrap.chainSeeds;
  const chainAdmission = buildRuntimeChainAdmission({
    admittedChainSeeds: chainDefinitionSeed.filter((entry) =>
      registeredNamespaces.has(getChainRefNamespace(entry.definition.chainRef)),
    ),
  });

  const storageNow = storageOptions?.now ?? Date.now;
  const hydrationEnabled = storageOptions?.hydrate ?? true;

  const backgroundAssemblyOptions: BackgroundAssemblyOptions = {
    ...(approvalOptions ? { approvals: { ...approvalOptions, logger: approvalOptions.logger ?? storageLogger } } : {}),
    ...(transactionOptions ? { transactions: transactionOptions } : {}),
    chainDefinitions: { ...chainDefinitionsOptions, seed: [...chainDefinitionSeed] },
  };

  return {
    messenger,
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
    walletChainSelection,
    providerChainSelection,
    chainRpcDefaultEndpoints,
    chainRpcEndpointOverrides,
    accountsStore,
    keyringMetas,
  } = initRuntimeStoreServices({
    messenger: bootstrapScope.messenger,
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
    accountAddressing: bootstrapScope.namespaceBootstrap.accountAddressing,
    accountsService: accountsStore,
    permissionsPort: storePorts.permissions,
    options: bootstrapScope.backgroundAssemblyOptions,
  });

  const { stateServices, chainRpcAccessUpdater, chainDefinitionsService, permissionsReady } = stateServicesInit;

  const chainViews = createChainViewsService({
    chainDefinitions: chainDefinitionsService,
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
  const resolvedKeyringNamespaces =
    sessionOptions?.keyringNamespaces ?? bootstrapScope.namespaceBootstrap.keyringNamespaces;
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
  const accountSigning = createAccountSigningService({
    keyring: sessionLayer.keyringService,
  });

  return {
    stateServices,
    chainRpcAccessUpdater,
    permissionsReady,
    chainViews,
    chainActivation,
    attention,
    walletChainSelection,
    providerChainSelection,
    chainRpcDefaultEndpoints,
    chainRpcEndpointOverrides,
    sessionLayer,
    accountSigning,
    keyringService: sessionLayer.keyringService,
    runtimeLifecycle,
  };
};

export const createBackgroundSupportScope = ({
  bootstrapScope,
  sessionScope,
  rpcClientOptions,
}: {
  bootstrapScope: BackgroundBootstrapScope;
  sessionScope: BackgroundSessionScope;
  rpcClientOptions?: RpcLayerOptions;
}): BackgroundSupportScope => {
  const manifestRpcClientFactories = bootstrapScope.namespaceBootstrap.rpcClientFactories;
  const overrideRpcClientFactories = rpcClientOptions?.factories ?? [];
  const chainRpcClientPool = initRpcLayer({
    stateServices: sessionScope.stateServices,
    ...(rpcClientOptions?.options ? { rpcClientOptions: { options: rpcClientOptions.options } } : {}),
    factories: [...manifestRpcClientFactories, ...overrideRpcClientFactories],
  });

  const materializedNamespaceRuntime = materializeNamespaceRuntime({
    manifests: bootstrapScope.namespaceBootstrap.manifests,
    rpcClients: chainRpcClientPool,
    chains: bootstrapScope.namespaceBootstrap.chainAddressing,
    accountSigning: sessionScope.accountSigning,
    ...(bootstrapScope.backgroundAssemblyOptions.transactions?.namespaces
      ? { transactionOverrides: bootstrapScope.backgroundAssemblyOptions.transactions.namespaces }
      : {}),
  });
  const namespaceTransactions = materializedNamespaceRuntime.namespaceTransactions;

  const permissionViews = createPermissionViewsService({
    accounts: sessionScope.stateServices.accounts,
    permissions: sessionScope.stateServices.permissions,
  });

  const chainRpcBootstrap = createChainRpcBootstrap({
    chainRpcAccessUpdater: sessionScope.chainRpcAccessUpdater,
    chainDefinitions: sessionScope.stateServices.chainDefinitions,
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
    namespaceRuntime: materializedNamespaceRuntime.services,
    permissionViews,
    chainRpcBootstrap,
  };
};
