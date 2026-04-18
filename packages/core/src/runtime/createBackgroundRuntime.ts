import type { AccountCodecRegistry } from "../accounts/addressing/codec.js";
import { assembleArxWalletRuntime } from "../engine/createArxWallet.js";
import { createWalletNamespaceModuleFromManifest } from "../engine/modules/manifestInterop.js";
import type { ArxWallet, WalletCreateUiOptions } from "../engine/types.js";
import type { Messenger, ViolationMode } from "../messenger/Messenger.js";
import type { NamespaceManifest } from "../namespaces/types.js";
import type { HandlerControllers, Namespace } from "../rpc/handlers/types.js";
import type { RpcInvocationContext, resolveRpcInvocation, resolveRpcInvocationDetails } from "../rpc/index.js";
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
import type { TransactionsPort } from "../services/store/transactions/port.js";
import type { VaultMetaPort } from "../storage/index.js";
import type { CustomRpcRecord } from "../storage/records.js";
import type { UiRuntimeAccess } from "../ui/server/types.js";
import type { ControllerLayerOptions } from "./background/controllers.js";
import type { EngineOptions, initEngine } from "./background/engine.js";
import type { BackgroundRpcEnvHooks } from "./background/rpcEngineAssembly.js";
import type { initRpcLayer, RpcLayerOptions } from "./background/rpcLayer.js";
import type { BackgroundSessionServices, SessionOptions } from "./background/session.js";
import type { KeyringService } from "./keyring/KeyringService.js";
import type { ProviderRuntimeAccess } from "./provider/types.js";

export type { UiMethodHandlerMap, UiPlatformAdapter, UiRuntimeAccess, UiServerExtension } from "../ui/server/types.js";
export type { BackgroundSessionServices } from "./background/session.js";

export type BackgroundRuntimeUiAccessOptions = WalletCreateUiOptions;

export type CreateBackgroundRuntimeOptions = Omit<ControllerLayerOptions, "supportedChains"> & {
  messenger?: {
    violationMode?: ViolationMode;
  };
  engine?: EngineOptions;
  rpcEngine: {
    env: BackgroundRpcEnvHooks;
    assemble?: boolean;
  };
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
      transactions: TransactionsPort;
      accounts: AccountsPort;
      customChains?: CustomChainsPort;
      keyringMetas: KeyringMetasPort;
      permissions: PermissionsPort;
    };
  };
  supportedChains?: Omit<NonNullable<ControllerLayerOptions["supportedChains"]>, "port"> & {
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
  controllers: HandlerControllers;
  services: {
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
    engine: ReturnType<typeof initEngine>;
    registry: ReturnType<typeof assembleArxWalletRuntime>["rpc"]["namespaceIndex"];
    clients: ReturnType<typeof initRpcLayer>;
    resolveContextNamespace: (context?: RpcInvocationContext) => Namespace | null;
    resolveMethodNamespace: (method: string, context?: RpcInvocationContext) => Namespace | null;
    resolveInvocation: (method: string, context?: RpcInvocationContext) => ReturnType<typeof resolveRpcInvocation>;
    resolveInvocationDetails: (
      method: string,
      context?: RpcInvocationContext,
    ) => ReturnType<typeof resolveRpcInvocationDetails>;
    executeRequest: ReturnType<typeof assembleArxWalletRuntime>["rpc"]["executeRequest"];
  };
  surfaceErrors: ReturnType<typeof assembleArxWalletRuntime>["surfaceErrors"];
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
        settings: options.settings.port,
        transactions: options.store.ports.transactions,
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
      controllerOptions: {
        ...(options.network ? { network: options.network } : {}),
        ...(options.accounts ? { accounts: options.accounts } : {}),
        ...(options.approvals ? { approvals: options.approvals } : {}),
        ...(options.transactions ? { transactions: options.transactions } : {}),
        supportedChains,
      },
      ...(options.engine ? { engine: options.engine } : {}),
      ...(options.rpcClients ? { rpcClients: options.rpcClients } : {}),
      rpcEngine: options.rpcEngine,
      ...(options.session ? { session: options.session } : {}),
    },
  });

  return {
    bus: runtime.bus,
    controllers: runtime.controllers,
    services: runtime.services,
    rpc: {
      engine: runtime.rpc.engine,
      registry: runtime.rpc.namespaceIndex,
      clients: runtime.rpc.clients,
      resolveContextNamespace: runtime.rpc.resolveContextNamespace,
      resolveMethodNamespace: runtime.rpc.resolveMethodNamespace,
      resolveInvocation: runtime.rpc.resolveInvocation,
      resolveInvocationDetails: runtime.rpc.resolveInvocationDetails,
      executeRequest: runtime.rpc.executeRequest,
    },
    surfaceErrors: runtime.surfaceErrors,
    lifecycle: runtime.lifecycle,
    providerAccess: runtime.providerAccess,
    createUiAccess: runtime.createUiAccess,
    wallet: runtime.wallet,
  };
};
