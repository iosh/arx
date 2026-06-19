import type { AccountCodecRegistry } from "../accounts/addressing/codec.js";
import { assembleArxWalletRuntime } from "../engine/createArxWallet.js";
import { createWalletNamespaceModuleFromManifest } from "../engine/modules/manifestInterop.js";
import type { ArxWallet, WalletCreateUiOptions } from "../engine/types.js";
import type { Messenger, ViolationMode } from "../messenger/Messenger.js";
import type { NamespaceManifest } from "../namespaces/types.js";
import type { Namespace } from "../rpc/handlers/types.js";
import type { RpcInvocationHint, resolveRpcInvocation, resolveRpcInvocationDetails } from "../rpc/index.js";
import type { AccountSigningService } from "../services/runtime/accountSigning.js";
import type { createAttentionService } from "../services/runtime/attention/index.js";
import type { createChainActivationService } from "../services/runtime/chainActivation/index.js";
import type { createChainViewsService } from "../services/runtime/chainViews/index.js";
import type { KeyringExportService } from "../services/runtime/keyringExport.js";
import type { createPermissionViewsService } from "../services/runtime/permissionViews/index.js";
import type { SessionStatusService } from "../services/runtime/sessionStatus.js";
import type { AccountsPort } from "../services/store/accounts/port.js";
import type { ChainDefinitionsPort } from "../services/store/chainDefinitions/port.js";
import type { ChainRpcDefaultEndpointsPort } from "../services/store/chainRpcDefaultEndpoints/port.js";
import type { ChainRpcEndpointOverridesPort } from "../services/store/chainRpcEndpointOverrides/port.js";
import type { KeyringMetasPort } from "../services/store/keyringMetas/port.js";
import type { PermissionsPort } from "../services/store/permissions/port.js";
import type { ProviderChainSelectionPort } from "../services/store/providerChainSelection/port.js";
import type { ProviderChainSelectionService } from "../services/store/providerChainSelection/types.js";
import type { SettingsPort } from "../services/store/settings/port.js";
import type { WalletChainSelectionPort } from "../services/store/walletChainSelection/port.js";
import type { WalletChainSelectionService } from "../services/store/walletChainSelection/types.js";
import type { VaultMetaPort } from "../storage/index.js";
import type { TransactionsStoragePort } from "../transactions/storage/index.js";
import type { UiRuntimeAccess } from "../ui/server/types.js";
import type { BackgroundStateServices } from "./background/backgroundStateServices.js";
import type { BackgroundRpcAccessPolicyHooks } from "./background/rpcAccessPolicy.js";
import type { initRpcLayer, RpcLayerOptions } from "./background/rpcLayer.js";
import type { BackgroundAssemblyOptions } from "./background/runtimeScopes.js";
import type { BackgroundSessionServices, SessionOptions } from "./background/session.js";
import type { KeyringService } from "./keyring/KeyringService.js";
import type { ProviderRuntimeAccess } from "./provider/types.js";

export type { UiMethodHandlerMap, UiPlatformAdapter, UiRuntimeAccess, UiServerExtension } from "../ui/server/types.js";
export type { BackgroundSessionServices } from "./background/session.js";

export type BackgroundRuntimeUiAccessOptions = WalletCreateUiOptions;

export type CreateBackgroundRuntimeOptions = Omit<BackgroundAssemblyOptions, "supportedChains"> & {
  messenger?: {
    violationMode?: ViolationMode;
  };
  rpcAccessPolicy: BackgroundRpcAccessPolicyHooks;
  walletChainSelection: {
    port: WalletChainSelectionPort;
  };
  providerChainSelection: {
    port: ProviderChainSelectionPort;
  };
  chainRpcEndpointOverrides: {
    port: ChainRpcEndpointOverridesPort;
  };
  chainRpcDefaultEndpoints: {
    port: ChainRpcDefaultEndpointsPort;
  };
  storage?: {
    vaultMetaPort?: VaultMetaPort;
    now?: () => number;
    hydrate?: boolean;
    logger?: (message: string, error?: unknown) => void;
  };
  store: {
    ports: {
      accounts: AccountsPort;
      chainDefinitions: ChainDefinitionsPort;
      keyringMetas: KeyringMetasPort;
      permissions: PermissionsPort;
      transactionAggregates: TransactionsStoragePort;
    };
  };
  supportedChains?: Omit<NonNullable<BackgroundAssemblyOptions["supportedChains"]>, "port">;
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
  transactions: ReturnType<typeof assembleArxWalletRuntime>["transactions"];
  transactionMonitor: ReturnType<typeof assembleArxWalletRuntime>["transactionMonitor"];
  services: BackgroundStateServices & {
    attention: ReturnType<typeof createAttentionService>;
    chainActivation: ReturnType<typeof createChainActivationService>;
    chainViews: ReturnType<typeof createChainViewsService>;
    permissionViews: ReturnType<typeof createPermissionViewsService>;
    accountCodecs: AccountCodecRegistry;
    walletChainSelection: WalletChainSelectionService;
    providerChainSelection: ProviderChainSelectionService;
    namespaceBindings: ReturnType<typeof assembleArxWalletRuntime>["services"]["namespaceBindings"];
    namespaceRuntimeSupport: ReturnType<typeof assembleArxWalletRuntime>["services"]["namespaceRuntimeSupport"];
    session: BackgroundSessionServices;
    sessionStatus: SessionStatusService;
    accountSigning: AccountSigningService;
    keyringExport: KeyringExportService;
    keyring: KeyringService;
  };
  rpc: {
    registry: ReturnType<typeof assembleArxWalletRuntime>["rpc"]["namespaceIndex"];
    clients: ReturnType<typeof initRpcLayer>;
    resolveHintNamespace: (hint?: RpcInvocationHint) => Namespace | null;
    resolveMethodNamespace: (method: string, hint?: RpcInvocationHint) => Namespace | null;
    resolveInvocation: (method: string, hint?: RpcInvocationHint) => ReturnType<typeof resolveRpcInvocation>;
    resolveInvocationDetails: (
      method: string,
      hint?: RpcInvocationHint,
    ) => ReturnType<typeof resolveRpcInvocationDetails>;
    executeRequest: ReturnType<typeof assembleArxWalletRuntime>["rpc"]["executeRequest"];
  };
  lifecycle: ReturnType<typeof assembleArxWalletRuntime>["lifecycle"];
  providerAccess: ProviderRuntimeAccess;
  createUiAccess: (options: BackgroundRuntimeUiAccessOptions) => UiRuntimeAccess;
  wallet: ArxWallet;
};

const createNoopVaultMetaPort = (): VaultMetaPort => ({
  async loadVaultMeta() {
    return null;
  },
  async saveVaultMeta() {},
  async clearVaultMeta() {},
});

export const createBackgroundRuntime = (options: CreateBackgroundRuntimeOptions): BackgroundRuntime => {
  const chainDefinitionsPort = options.store.ports.chainDefinitions;
  const supportedChains = {
    ...(options.supportedChains ?? {}),
    port: chainDefinitionsPort,
  };

  const walletChainSelectionPort = options.walletChainSelection.port;
  const providerChainSelectionPort = options.providerChainSelection.port;
  const chainRpcDefaultEndpointsPort = options.chainRpcDefaultEndpoints.port;
  const chainRpcEndpointOverridesPort = options.chainRpcEndpointOverrides.port;
  const vaultMetaPort = options.storage?.vaultMetaPort ?? createNoopVaultMetaPort();

  const modules = options.namespaces.manifests.map((manifest) => createWalletNamespaceModuleFromManifest(manifest));
  const runtime = assembleArxWalletRuntime({
    namespaces: {
      modules,
    },
    storage: {
      ports: {
        vault: vaultMetaPort,
        keyrings: options.store.ports.keyringMetas,
        accounts: options.store.ports.accounts,
        permissions: options.store.ports.permissions,
        chains: {
          chainDefinitions: chainDefinitionsPort,
          chainRpcDefaultEndpoints: chainRpcDefaultEndpointsPort,
          chainRpcEndpointOverrides: chainRpcEndpointOverridesPort,
          walletChainSelection: walletChainSelectionPort,
          providerChainSelection: providerChainSelectionPort,
        },
        transactions: options.store.ports.transactionAggregates,
        settings: options.settings.port,
      },
      ...(options.storage?.hydrate !== undefined ? { hydrate: options.storage.hydrate } : {}),
    },
    env: {
      ...(options.storage?.now ? { now: options.storage.now } : {}),
      ...(options.storage?.logger ? { logger: options.storage.logger } : {}),
    },
    runtime: {
      boot: false,
      lifecycleLabel: "createBackgroundRuntime",
      ...(options.messenger ? { messenger: options.messenger } : {}),
      assemblyOptions: {
        ...(options.approvals ? { approvals: options.approvals } : {}),
        ...(options.transactions ? { transactions: options.transactions } : {}),
        supportedChains,
      },
      ...(options.rpcClients ? { rpcClients: options.rpcClients } : {}),
      rpcAccessPolicy: options.rpcAccessPolicy,
      ...(options.session ? { session: options.session } : {}),
    },
  });

  return {
    bus: runtime.bus,
    transactions: runtime.transactions,
    transactionMonitor: runtime.transactionMonitor,
    services: runtime.services,
    rpc: {
      registry: runtime.rpc.namespaceIndex,
      clients: runtime.rpc.clients,
      resolveHintNamespace: runtime.rpc.resolveHintNamespace,
      resolveMethodNamespace: runtime.rpc.resolveMethodNamespace,
      resolveInvocation: runtime.rpc.resolveInvocation,
      resolveInvocationDetails: runtime.rpc.resolveInvocationDetails,
      executeRequest: runtime.rpc.executeRequest,
    },
    lifecycle: runtime.lifecycle,
    providerAccess: runtime.providerAccess,
    createUiAccess: runtime.createUiAccess,
    wallet: runtime.wallet,
  };
};
