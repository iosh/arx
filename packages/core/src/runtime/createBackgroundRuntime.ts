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
import type { CustomChainsPort } from "../services/store/customChains/port.js";
import type { CustomRpcPort } from "../services/store/customRpc/port.js";
import type { KeyringMetasPort } from "../services/store/keyringMetas/port.js";
import type { NetworkSelectionPort } from "../services/store/networkSelection/port.js";
import type { NetworkSelectionService } from "../services/store/networkSelection/types.js";
import type { PermissionsPort } from "../services/store/permissions/port.js";
import type { SettingsPort } from "../services/store/settings/port.js";
import type { VaultMetaPort } from "../storage/index.js";
import type { CustomRpcRecord } from "../storage/records.js";
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
  networkSelection: {
    port: NetworkSelectionPort;
  };
  customRpc?: {
    port: CustomRpcPort;
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
      customChains?: CustomChainsPort;
      keyringMetas: KeyringMetasPort;
      permissions: PermissionsPort;
      transactionAggregates: TransactionsStoragePort;
    };
  };
  supportedChains?: Omit<NonNullable<BackgroundAssemblyOptions["supportedChains"]>, "port"> & {
    port?: CustomChainsPort;
  };
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
  services: BackgroundStateServices & {
    attention: ReturnType<typeof createAttentionService>;
    chainActivation: ReturnType<typeof createChainActivationService>;
    chainViews: ReturnType<typeof createChainViewsService>;
    permissionViews: ReturnType<typeof createPermissionViewsService>;
    accountCodecs: AccountCodecRegistry;
    networkSelection: NetworkSelectionService;
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

const createEphemeralCustomRpcPort = (): CustomRpcPort => {
  const records = new Map<CustomRpcRecord["chainRef"], CustomRpcRecord>();

  return {
    async get(chainRef) {
      return records.get(chainRef) ?? null;
    },
    async list() {
      return Array.from(records.values());
    },
    async upsert(record) {
      records.set(record.chainRef, structuredClone(record));
    },
    async remove(chainRef) {
      records.delete(chainRef);
    },
    async clear() {
      records.clear();
    },
  };
};

export const createBackgroundRuntime = (options: CreateBackgroundRuntimeOptions): BackgroundRuntime => {
  const customChainsPort = options.store.ports.customChains ?? options.supportedChains?.port;
  if (!customChainsPort) {
    throw new Error("createBackgroundRuntime requires a custom chains port");
  }

  const supportedChains = {
    ...(options.supportedChains ?? {}),
    port: customChainsPort,
  };

  const networkSelectionPort = options.networkSelection.port;
  const customRpcPort = options.customRpc?.port ?? createEphemeralCustomRpcPort();

  const modules = options.namespaces.manifests.map((manifest) => createWalletNamespaceModuleFromManifest(manifest));
  const runtime = assembleArxWalletRuntime({
    namespaces: {
      modules,
    },
    storage: {
      ports: {
        accounts: options.store.ports.accounts,
        customChains: customChainsPort,
        customRpc: customRpcPort,
        keyringMetas: options.store.ports.keyringMetas,
        networkSelection: networkSelectionPort,
        permissions: options.store.ports.permissions,
        transactionAggregates: options.store.ports.transactionAggregates,
        settings: options.settings.port,
      },
      ...(options.storage?.vaultMetaPort ? { vaultMetaPort: options.storage.vaultMetaPort } : {}),
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
        ...(options.network ? { network: options.network } : {}),
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
