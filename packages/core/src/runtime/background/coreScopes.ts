import type { AccountsPort } from "../../accounts/accountsPort.js";
import { createChainActivationService } from "../../chains/activation/index.js";
import { buildChainAdmission, type ChainAdmission } from "../../chains/bootstrap/chainAdmission.js";
import { createChainRpcBootstrap } from "../../chains/bootstrap/chainRpcBootstrap.js";
import { getChainRefNamespace } from "../../chains/caip.js";
import type { ChainDefinitionSeed, RpcEndpoint } from "../../chains/definition.js";
import type { ChainRpcDefaultEndpointsPort } from "../../chains/rpc/defaultEndpoints/port.js";
import type { ChainRpcDefaultEndpointsService } from "../../chains/rpc/defaultEndpoints/types.js";
import type { ChainRpcEndpointOverridesPort } from "../../chains/rpc/endpointOverrides/port.js";
import type { ChainRpcEndpointOverridesService } from "../../chains/rpc/endpointOverrides/types.js";
import type { ChainRpcAccessUpdater } from "../../chains/rpc/types.js";
import type { ProviderChainSelectionPort } from "../../chains/selection/provider/port.js";
import type { ProviderChainSelectionService } from "../../chains/selection/provider/types.js";
import type { WalletChainSelectionPort } from "../../chains/selection/wallet/port.js";
import type { WalletChainSelectionService } from "../../chains/selection/wallet/types.js";
import { createChainViewsService } from "../../chains/views/index.js";
import { type AccountSigningService, createAccountSigningService } from "../../keyring/accountSigning.js";
import type { KeyringMetasPort } from "../../keyring/keyringMetasPort.js";
import type { KeyringService } from "../../keyring/service/KeyringService.js";
import { createMessenger, type Messenger } from "../../messenger/index.js";
import {
  materializeNamespaceRuntime,
  type NamespaceRuntimeServices,
  type NamespaceStaticAssembly,
} from "../../namespaces/index.js";
import type { PermissionsPort } from "../../permissions/service/port.js";
import { createPermissionViewsService } from "../../permissions/views/index.js";
import { listRpcNamespaces } from "../../rpc/index.js";
import {
  createSessionLayer,
  type SessionLayer,
  type SessionLayerOptions,
  type SessionOptions,
} from "../../session/sessionLayer.js";
import type { VaultMetaPort } from "../../storage/index.js";
import type { NamespaceTransactions } from "../../transactions/namespace/NamespaceTransactions.js";
import { createAttentionService } from "../../wallet/attention/index.js";
import {
  type BackgroundStateServiceOptions,
  type BackgroundStateServices,
  initBackgroundStateServices,
} from "./backgroundStateServices.js";
import { initRpcLayer, type RpcLayerOptions } from "./rpcLayer.js";
import { createRuntimeLifecycle } from "./runtimeLifecycle.js";
import { initRuntimeStoreServices } from "./runtimeStoreServices.js";

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
  chainAdmission: ChainAdmission;
  hydrationEnabled: boolean;
  backgroundAssemblyOptions: BackgroundAssemblyOptions;
};

export type BackgroundCoreScope = {
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
  sessionLayer: SessionLayer;
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
  hydrate,
  approvalOptions,
  transactionOptions,
  chainDefinitionsOptions,
}: {
  namespaceBootstrap: NamespaceStaticAssembly;
  hydrate?: boolean;
  approvalOptions?: BackgroundAssemblyOptions["approvals"];
  transactionOptions?: BackgroundAssemblyOptions["transactions"];
  chainDefinitionsOptions: NonNullable<BackgroundAssemblyOptions["chainDefinitions"]>;
}): BackgroundBootstrapScope => {
  const messenger = createMessenger();
  const registeredNamespaces = new Set(listRpcNamespaces(namespaceBootstrap.rpcRouting));
  const chainDefinitionSeed = chainDefinitionsOptions.seed ?? namespaceBootstrap.chainSeeds;
  const chainAdmission = buildChainAdmission({
    admittedChainSeeds: chainDefinitionSeed.filter((entry) =>
      registeredNamespaces.has(getChainRefNamespace(entry.definition.chainRef)),
    ),
  });

  const hydrationEnabled = hydrate ?? true;

  const backgroundAssemblyOptions: BackgroundAssemblyOptions = {
    ...(approvalOptions ? { approvals: approvalOptions } : {}),
    ...(transactionOptions ? { transactions: transactionOptions } : {}),
    chainDefinitions: { ...chainDefinitionsOptions, seed: [...chainDefinitionSeed] },
  };

  return {
    messenger,
    namespaceBootstrap,
    registeredNamespaces,
    admittedChainSeeds: chainAdmission.admittedChainSeeds,
    chainAdmission,
    hydrationEnabled,
    backgroundAssemblyOptions,
  };
};

export const createBackgroundCoreScope = ({
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
}): BackgroundCoreScope => {
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
  });

  const attention = createAttentionService({
    messenger: bootstrapScope.messenger,
  });

  const runtimeLifecycle = createRuntimeLifecycle(lifecycleLabel ?? "createBackgroundRuntime");
  const resolvedKeyringNamespaces =
    sessionOptions?.keyringNamespaces ?? bootstrapScope.namespaceBootstrap.keyringNamespaces;
  const resolvedSessionOptions = extractSessionLayerOptions(sessionOptions);
  const sessionLayer = createSessionLayer({
    messenger: bootstrapScope.messenger,
    accountsStore,
    keyringMetas,
    keyringNamespaces: resolvedKeyringNamespaces,
    hydrationEnabled: bootstrapScope.hydrationEnabled,
    getIsHydrating: () => runtimeLifecycle.getIsHydrating(),
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
  coreScope,
  rpcClientOptions,
}: {
  bootstrapScope: BackgroundBootstrapScope;
  coreScope: BackgroundCoreScope;
  rpcClientOptions?: RpcLayerOptions;
}): BackgroundSupportScope => {
  const manifestRpcClientFactories = bootstrapScope.namespaceBootstrap.rpcClientFactories;
  const overrideRpcClientFactories = rpcClientOptions?.factories ?? [];
  const chainRpcClientPool = initRpcLayer({
    stateServices: coreScope.stateServices,
    ...(rpcClientOptions?.options ? { rpcClientOptions: { options: rpcClientOptions.options } } : {}),
    factories: [...manifestRpcClientFactories, ...overrideRpcClientFactories],
  });

  const materializedNamespaceRuntime = materializeNamespaceRuntime({
    manifests: bootstrapScope.namespaceBootstrap.manifests,
    rpcClients: chainRpcClientPool,
    chains: bootstrapScope.namespaceBootstrap.chainAddressing,
    accountSigning: coreScope.accountSigning,
    ...(bootstrapScope.backgroundAssemblyOptions.transactions?.namespaces
      ? { transactionOverrides: bootstrapScope.backgroundAssemblyOptions.transactions.namespaces }
      : {}),
  });
  const namespaceTransactions = materializedNamespaceRuntime.namespaceTransactions;

  const permissionViews = createPermissionViewsService({
    accounts: coreScope.stateServices.accounts,
    permissions: coreScope.stateServices.permissions,
  });

  const chainRpcBootstrap = createChainRpcBootstrap({
    chainRpcAccessUpdater: coreScope.chainRpcAccessUpdater,
    chainDefinitions: coreScope.stateServices.chainDefinitions,
    selection: coreScope.walletChainSelection,
    defaultEndpoints: coreScope.chainRpcDefaultEndpoints,
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
    endpointOverrides: coreScope.chainRpcEndpointOverrides,
    selectionDefaults: bootstrapScope.chainAdmission.selectionDefaults,
    hydrationEnabled: bootstrapScope.hydrationEnabled,
    getIsHydrating: () => coreScope.runtimeLifecycle.getIsHydrating(),
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
