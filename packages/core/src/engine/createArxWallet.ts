import { createApprovalExecutor, createApprovalFlowRegistry } from "../approvals/index.js";
import { createSurfaceErrorEncoder, type SurfaceErrorEncoder } from "../errors/index.js";
import type { ViolationMode } from "../messenger/Messenger.js";
import {
  createRpcContextNamespaceResolver,
  createRpcMethodExecutor,
  createRpcMethodNamespaceResolver,
  createRpcRegistry,
  type HandlerControllers,
  type JsonRpcError,
  resolveRpcInvocation,
  resolveRpcInvocationDetails,
} from "../rpc/index.js";
import type { ControllerLayerOptions } from "../runtime/background/controllers.js";
import type { EngineOptions } from "../runtime/background/engine.js";
import {
  type BackgroundRpcEnvHooks,
  type BackgroundRpcRuntime,
  createRpcEngineForBackground,
} from "../runtime/background/rpcEngineAssembly.js";
import type { RpcLayerOptions } from "../runtime/background/rpcLayer.js";
import { createBackgroundRuntimeLifecycle } from "../runtime/background/runtimeLifecyclePlan.js";
import {
  createRuntimeBootstrapScope,
  createRuntimeSessionScope,
  createRuntimeSupportScope,
} from "../runtime/background/runtimeScopes.js";
import type { SessionOptions } from "../runtime/background/session.js";
import { createProviderRuntimeAccess } from "../runtime/provider/createProviderRuntimeAccess.js";
import { createProviderRequests } from "../runtime/provider/providerRequests.js";
import type { ProviderRuntimeAccess } from "../runtime/provider/types.js";
import { ATTENTION_STATE_CHANGED } from "../services/runtime/attention/index.js";
import type { UiError } from "../ui/protocol/envelopes.js";
import { createUiContract, createUiRuntimeAccess } from "../ui/server/access.js";
import { createUiKeyringsAccess } from "../ui/server/keyringsAccess.js";
import { createUiSessionAccess } from "../ui/server/sessionAccess.js";
import type { UiRuntimeAccess, UiRuntimeDeps } from "../ui/server/types.js";
import { createUiWalletSetupAccess } from "../ui/server/walletSetupAccess.js";
import { assembleRuntimeNamespaceStagesFromWalletModules } from "./modules/manifestInterop.js";
import { createWalletNamespaces } from "./namespaces.js";
import type { ArxWallet, CreateArxWalletInput, WalletCreateUiOptions, WalletProvider } from "./types.js";
import {
  createWalletAccounts,
  createWalletApprovals,
  createWalletAttention,
  createWalletDappConnections,
  createWalletNetworks,
  createWalletPermissions,
  createWalletProvider,
  createWalletSession,
  createWalletSnapshots,
  createWalletTransactions,
} from "./wallet.js";

type RuntimeBootstrapScope = ReturnType<typeof createRuntimeBootstrapScope>;
type RuntimeSessionScope = ReturnType<typeof createRuntimeSessionScope>;
type RuntimeSupportScope = ReturnType<typeof createRuntimeSupportScope>;
type RuntimeLifecycle = ReturnType<typeof createBackgroundRuntimeLifecycle>;

const DEFAULT_RPC_ENV_HOOKS = {
  isInternalOrigin: () => false,
  shouldRequestUnlockAttention: () => false,
} satisfies BackgroundRpcEnvHooks;

type WalletRuntimeServices = Readonly<{
  attention: RuntimeSessionScope["attention"];
  chainActivation: RuntimeSessionScope["chainActivation"];
  chainViews: RuntimeSessionScope["chainViews"];
  permissionViews: RuntimeSupportScope["permissionViews"];
  accountCodecs: RuntimeBootstrapScope["namespaceBootstrap"]["accountCodecs"];
  networkSelection: RuntimeSessionScope["networkSelection"];
  customRpc: RuntimeSessionScope["customRpc"];
  namespaceBindings: RuntimeSupportScope["namespaceBindings"];
  namespaceRuntimeSupport: RuntimeSupportScope["namespaceRuntimeSupport"];
  session: RuntimeSessionScope["sessionLayer"]["session"];
  sessionStatus: RuntimeSessionScope["sessionStatus"];
  accountSigning: RuntimeSessionScope["accountSigning"];
  keyringExport: RuntimeSessionScope["keyringExport"];
  keyring: RuntimeSessionScope["keyringService"];
}>;

type ArxWalletRuntimeCore = Readonly<{
  bus: RuntimeBootstrapScope["bus"];
  controllers: HandlerControllers;
  services: WalletRuntimeServices;
  surfaceErrors: SurfaceErrorEncoder;
}>;

type CreateArxWalletRuntimeInput = CreateArxWalletInput &
  Readonly<{
    runtime?: Readonly<{
      boot?: boolean;
      lifecycleLabel?: string;
      messenger?: Readonly<{
        violationMode?: ViolationMode;
      }>;
      controllerOptions?: ControllerLayerOptions;
      engine?: EngineOptions;
      rpcClients?: RpcLayerOptions;
      rpcEngine?: Readonly<{
        env?: BackgroundRpcEnvHooks;
        assemble?: boolean;
      }>;
      session?: SessionOptions;
    }>;
  }>;

type ArxWalletRuntime = Readonly<{
  wallet: ArxWallet;
  shutdown(): Promise<void>;
  bus: RuntimeBootstrapScope["bus"];
  controllers: HandlerControllers;
  services: WalletRuntimeServices;
  lifecycle: RuntimeLifecycle;
  rpc: Readonly<{
    engine: RuntimeSessionScope["engine"];
    namespaceIndex: RuntimeBootstrapScope["rpcRegistry"];
    clients: RuntimeSupportScope["rpcClientRegistry"];
    resolveContextNamespace: ReturnType<typeof createRpcContextNamespaceResolver>;
    resolveMethodNamespace: ReturnType<typeof createRpcMethodNamespaceResolver>;
    resolveInvocation: (
      method: string,
      context?: Parameters<typeof resolveRpcInvocation>[3],
    ) => ReturnType<typeof resolveRpcInvocation>;
    resolveInvocationDetails: (
      method: string,
      context?: Parameters<typeof resolveRpcInvocationDetails>[3],
    ) => ReturnType<typeof resolveRpcInvocationDetails>;
    executeRequest: ReturnType<typeof createRpcMethodExecutor>;
  }>;
  provider: WalletProvider;
  providerAccess: ProviderRuntimeAccess;
  createUiAccess(options: WalletCreateUiOptions): UiRuntimeAccess;
  surfaceErrors: SurfaceErrorEncoder;
}>;

const buildStorageOptions = (
  input: CreateArxWalletInput,
): { now?: () => number; logger?: (message: string, error?: unknown) => void; hydrate?: boolean } | undefined => {
  const storageOptions: {
    now?: () => number;
    logger?: (message: string, error?: unknown) => void;
    hydrate?: boolean;
  } = {};

  if (input.env?.now) {
    storageOptions.now = input.env.now;
  }
  if (input.env?.logger) {
    storageOptions.logger = input.env.logger;
  }
  if (input.storage.hydrate !== undefined) {
    storageOptions.hydrate = input.storage.hydrate;
  }

  return Object.keys(storageOptions).length > 0 ? storageOptions : undefined;
};

const bootWalletLifecycle = async (lifecycle: Pick<RuntimeLifecycle, "initialize" | "start">): Promise<void> => {
  await lifecycle.initialize();
  lifecycle.start();
};

const buildRuntimeSessionOptions = (input: CreateArxWalletRuntimeInput): SessionOptions | undefined => {
  const sessionOptions: SessionOptions = {
    ...(input.runtime?.session ?? {}),
    ...(input.env?.randomUuid ? { uuid: input.env.randomUuid } : {}),
  };

  return Object.keys(sessionOptions).length > 0 ? sessionOptions : undefined;
};

const createWalletUiDeps = (runtime: ArxWalletRuntimeCore, options: WalletCreateUiOptions): UiRuntimeDeps => {
  const session = createUiSessionAccess({
    session: runtime.services.session,
    sessionStatus: runtime.services.sessionStatus,
    keyring: runtime.services.keyring,
  });

  return {
    server: {
      access: {
        accounts: runtime.controllers.accounts,
        approvals: runtime.controllers.approvals,
        permissions: {
          buildUiPermissionsSnapshot: () => runtime.services.permissionViews.buildUiPermissionsSnapshot(),
        },
        transactions: runtime.controllers.transactions,
        chains: {
          buildWalletNetworksSnapshot: () => runtime.services.chainViews.buildWalletNetworksSnapshot(),
          findAvailableChainView: (chainRef) => runtime.services.chainViews.findAvailableChainView(chainRef),
          getApprovalReviewChainView: (chainRef) => runtime.services.chainViews.getApprovalReviewChainView(chainRef),
          getActiveChainViewForNamespace: (namespace) =>
            runtime.services.chainViews.getActiveChainViewForNamespace(namespace),
          getSelectedNamespace: () => runtime.services.chainViews.getSelectedNamespace(),
          getSelectedChainView: () => runtime.services.chainViews.getSelectedChainView(),
          requireAvailableChainMetadata: (chainRef) =>
            runtime.services.chainViews.requireAvailableChainMetadata(chainRef),
          selectWalletChain: (chainRef) => runtime.services.chainActivation.selectWalletChain(chainRef),
        },
        accountCodecs: runtime.services.accountCodecs,
        session,
        walletSetup: createUiWalletSetupAccess({
          accounts: runtime.controllers.accounts,
          session: runtime.services.session,
          keyring: runtime.services.keyring,
        }),
        keyrings: createUiKeyringsAccess({
          keyring: runtime.services.keyring,
          keyringExport: runtime.services.keyringExport,
        }),
        attention: {
          getSnapshot: () => runtime.services.attention.getSnapshot(),
        },
        namespaceBindings: runtime.services.namespaceBindings,
      },
      platform: options.platform,
      uiOrigin: options.uiOrigin,
      ...(options.extensions ? { extensions: options.extensions } : {}),
    },
    bridge: {
      encodeError: (error, context) =>
        runtime.surfaceErrors.encodeUi(error, {
          namespace: context.namespace,
          chainRef: context.chainRef,
          method: context.method,
        }) as UiError,
      persistVaultMeta: runtime.services.session.persistVaultMeta,
      stateChanged: {
        accounts: runtime.controllers.accounts,
        approvals: runtime.controllers.approvals,
        permissions: {
          onStateChanged: (listener) => runtime.controllers.permissions.onStateChanged(listener),
        },
        transactions: runtime.controllers.transactions,
        chains: {
          onStateChanged: (listener) => runtime.controllers.network.onStateChanged(listener),
          onSelectionChanged: (listener) => runtime.services.networkSelection.subscribeChanged(() => listener()),
        },
        session,
        attention: {
          onStateChanged: (listener) => runtime.bus.subscribe(ATTENTION_STATE_CHANGED, listener),
        },
      },
    },
  };
};

export const assembleArxWalletRuntime = (input: CreateArxWalletRuntimeInput): ArxWalletRuntime => {
  const modules = input.namespaces.modules;
  if (modules.length === 0) {
    throw new Error("createArxWallet requires at least one wallet namespace module");
  }

  const rpcRegistry = createRpcRegistry();
  const namespaces = createWalletNamespaces({ modules });
  const namespaceStages = assembleRuntimeNamespaceStagesFromWalletModules(namespaces.listModules());
  const storageOptions = buildStorageOptions(input);
  const approvalFlows = createApprovalFlowRegistry();
  const cleanupTasks: Array<() => void> = [];
  let sessionScope: RuntimeSessionScope | null = null;
  let runtimeSupportScope: RuntimeSupportScope | null = null;

  const requireSessionScope = () => {
    if (!sessionScope) {
      throw new Error("Wallet session scope is not initialized");
    }
    return sessionScope;
  };

  const requireRuntimeSupportScope = () => {
    if (!runtimeSupportScope) {
      throw new Error("Wallet runtime support scope is not initialized");
    }
    return runtimeSupportScope;
  };

  const controllerOptions = input.runtime?.controllerOptions;
  const runtimeSessionOptions = buildRuntimeSessionOptions(input);
  const runtimeRpcEnv = input.runtime?.rpcEngine?.env ?? DEFAULT_RPC_ENV_HOOKS;

  const bootstrapScope: RuntimeBootstrapScope = createRuntimeBootstrapScope({
    rpcRegistry,
    namespaceBootstrap: namespaceStages.bootstrap,
    ...(input.runtime?.messenger ? { messengerOptions: input.runtime.messenger } : {}),
    ...(storageOptions ? { storageOptions } : {}),
    ...(controllerOptions?.network ? { networkOptions: controllerOptions.network } : {}),
    ...(controllerOptions?.accounts ? { accountOptions: controllerOptions.accounts } : {}),
    ...(controllerOptions?.approvals ? { approvalOptions: controllerOptions.approvals } : {}),
    ...(controllerOptions?.transactions ? { transactionOptions: controllerOptions.transactions } : {}),
    supportedChainsOptions: {
      ...(controllerOptions?.supportedChains ?? {}),
      port: input.storage.ports.customChains,
    },
  });

  sessionScope = createRuntimeSessionScope({
    lifecycleLabel: input.runtime?.lifecycleLabel ?? "createArxWallet",
    bootstrapScope,
    namespaceSession: namespaceStages.session,
    settingsPort: input.storage.ports.settings,
    networkSelectionPort: input.storage.ports.networkSelection,
    customRpcPort: input.storage.ports.customRpc,
    storePorts: {
      accounts: input.storage.ports.accounts,
      keyringMetas: input.storage.ports.keyringMetas,
      permissions: input.storage.ports.permissions,
      transactions: input.storage.ports.transactions,
    },
    ...(input.runtime?.engine ? { engineOptions: input.runtime.engine } : {}),
    createApprovalExecutor: (controllersBase) =>
      createApprovalExecutor({
        registry: approvalFlows,
        getDeps: () => {
          const activeSessionScope = requireSessionScope();
          const activeRuntimeSupportScope = requireRuntimeSupportScope();

          return {
            accounts: controllersBase.accounts,
            permissions: controllersBase.permissions,
            transactions: controllersBase.transactions,
            chainActivation: activeSessionScope.chainActivation,
            supportedChains: controllersBase.supportedChains,
            namespaceBindings: activeRuntimeSupportScope.namespaceBindings,
          };
        },
      }),
    ...(input.storage.vaultMetaPort ? { vaultMetaPort: input.storage.vaultMetaPort } : {}),
    ...(runtimeSessionOptions ? { sessionOptions: runtimeSessionOptions } : {}),
  });

  runtimeSupportScope = createRuntimeSupportScope({
    bootstrapScope,
    sessionScope,
    namespaceRuntimeSupport: namespaceStages.runtimeSupport,
    ...(input.runtime?.rpcClients ? { rpcClientOptions: input.runtime.rpcClients } : {}),
  });

  const lifecycle = createBackgroundRuntimeLifecycle({
    runtimeLifecycle: sessionScope.runtimeLifecycle,
    controllersBase: sessionScope.controllersBase,
    permissionsReady: sessionScope.permissionsReady,
    deferredNetworkInitialState: sessionScope.deferredNetworkInitialState,
    registeredNamespaces: bootstrapScope.registeredNamespaces,
    transactionsLifecycle: runtimeSupportScope.transactionsLifecycle,
    networkBootstrap: runtimeSupportScope.networkBootstrap,
    sessionLayer: sessionScope.sessionLayer,
    rpcClientRegistry: runtimeSupportScope.rpcClientRegistry,
    engine: sessionScope.engine,
    bus: bootstrapScope.bus,
    logger: bootstrapScope.storageLogger,
  });
  const controllers: HandlerControllers = {
    ...sessionScope.controllersBase,
    networkSelection: sessionScope.networkSelection,
    chainAddressCodecs: bootstrapScope.namespaceBootstrap.chainAddressCodecs,
    clock: {
      now: bootstrapScope.storageNow,
    },
    signers: runtimeSupportScope.signers,
  };
  const resolveMethodNamespace = createRpcMethodNamespaceResolver(rpcRegistry);
  const resolveContextNamespace = createRpcContextNamespaceResolver(rpcRegistry);
  const resolveInvocation = (method: string, context?: Parameters<typeof resolveRpcInvocation>[3]) =>
    resolveRpcInvocation(rpcRegistry, controllers, method, context);
  const resolveInvocationDetails = (method: string, context?: Parameters<typeof resolveRpcInvocationDetails>[3]) =>
    resolveRpcInvocationDetails(rpcRegistry, controllers, method, context);
  const executeRequest = createRpcMethodExecutor({
    registry: rpcRegistry,
    controllers,
    rpcClientRegistry: runtimeSupportScope.rpcClientRegistry,
    services: {
      permissionViews: runtimeSupportScope.permissionViews,
    },
  });
  const surfaceErrorEncoder = createSurfaceErrorEncoder(rpcRegistry);
  const engineRuntime: BackgroundRpcRuntime = {
    controllers,
    services: {
      attention: sessionScope.attention,
      permissionViews: runtimeSupportScope.permissionViews,
      sessionStatus: sessionScope.sessionStatus,
    },
    rpc: {
      engine: sessionScope.engine,
      resolveMethodNamespace,
      resolveInvocationDetails,
      executeRequest,
    },
    surfaceErrors: surfaceErrorEncoder,
    lifecycle,
  };

  if (input.runtime?.rpcEngine?.assemble !== false) {
    // Keep request middleware assembly shared so provider execution and error
    // handling stay on the same path.
    createRpcEngineForBackground(engineRuntime, runtimeRpcEnv);
  }

  const providerRequests = createProviderRequests({
    generateId: input.env?.randomUuid ?? (() => globalThis.crypto.randomUUID()),
    now: bootstrapScope.storageNow,
    cancelApproval: async (input) => {
      await sessionScope.controllersBase.approvals.cancel(input);
    },
  });
  const providerAccess = createProviderRuntimeAccess({
    getSessionStatus: () => sessionScope.sessionStatus.getStatus(),
    getActiveChainViewForNamespace: (namespace) => sessionScope.chainViews.getActiveChainViewForNamespace(namespace),
    buildProviderMeta: (namespace) => sessionScope.chainViews.buildProviderMeta(namespace),
    getActiveChainByNamespace: () => sessionScope.networkSelection.getChainRefByNamespace(),
    listPermittedAccountsView: (origin, options) =>
      runtimeSupportScope.permissionViews.listPermittedAccounts(origin, options),
    formatAddress: (input) => bootstrapScope.namespaceBootstrap.chainAddressCodecs.formatAddress(input),
    resolveMethodNamespace,
    handleRpcRequest: (request, callback) => sessionScope.engine.handle(request, callback),
    encodeDappError: (error, context) => surfaceErrorEncoder.encodeDapp(error, context) as JsonRpcError,
    providerRequests,
    subscribeSessionUnlocked: (listener) => sessionScope.sessionLayer.session.unlock.onUnlocked(listener),
    subscribeSessionLocked: (listener) => sessionScope.sessionLayer.session.unlock.onLocked(listener),
    subscribeNetworkStateChanged: (listener) => sessionScope.controllersBase.network.onStateChanged(listener),
    subscribeNetworkSelectionChanged: (listener) => sessionScope.networkSelection.subscribeChanged(() => listener()),
    subscribeAccountsStateChanged: (listener) => sessionScope.controllersBase.accounts.onStateChanged(listener),
    subscribePermissionsStateChanged: (listener) => sessionScope.controllersBase.permissions.onStateChanged(listener),
  });
  const session = createWalletSession({
    session: sessionScope.sessionLayer.session,
    sessionStatus: sessionScope.sessionStatus,
    keyring: sessionScope.keyringService,
  });
  const accounts = createWalletAccounts({
    accounts: sessionScope.controllersBase.accounts,
    keyring: sessionScope.keyringService,
    keyringExport: sessionScope.keyringExport,
  });
  const approvals = createWalletApprovals({
    approvals: sessionScope.controllersBase.approvals,
    accounts,
    chainViews: sessionScope.chainViews,
    transactions: sessionScope.controllersBase.transactions,
  });
  const permissions = createWalletPermissions({
    permissions: sessionScope.controllersBase.permissions,
  });
  const networks = createWalletNetworks({
    networkSelection: sessionScope.networkSelection,
    supportedChains: sessionScope.controllersBase.supportedChains,
    customRpc: sessionScope.customRpc,
    chainViews: sessionScope.chainViews,
    chainActivation: sessionScope.chainActivation,
    network: sessionScope.controllersBase.network,
  });
  const transactions = createWalletTransactions({
    transactions: sessionScope.controllersBase.transactions,
  });
  const attention = createWalletAttention({
    attention: sessionScope.attention,
  });
  const dappConnections = createWalletDappConnections({
    ...(input.env?.now ? { now: input.env.now } : {}),
    sessionStatus: sessionScope.sessionStatus,
    permissionViews: runtimeSupportScope.permissionViews,
    chainViews: sessionScope.chainViews,
    chainAddressCodecs: bootstrapScope.namespaceBootstrap.chainAddressCodecs,
    subscribeSessionLocked: (listener) => sessionScope.sessionLayer.session.unlock.onLocked(() => listener()),
    subscribeAccountsStateChanged: (listener) => sessionScope.controllersBase.accounts.onStateChanged(() => listener()),
    subscribePermissionsStateChanged: (listener) =>
      sessionScope.controllersBase.permissions.onStateChanged(() => listener()),
    subscribeNetworkStateChanged: (listener) => sessionScope.controllersBase.network.onStateChanged(() => listener()),
    subscribeNetworkSelectionChanged: (listener) => sessionScope.networkSelection.subscribeChanged(() => listener()),
    registerCleanup: (cleanup) => {
      cleanupTasks.push(cleanup);
    },
  });
  const snapshots = createWalletSnapshots({
    session: sessionScope.sessionLayer.session,
    sessionStatus: sessionScope.sessionStatus,
    keyring: sessionScope.keyringService,
    attention: sessionScope.attention,
    chainViews: sessionScope.chainViews,
    permissionViews: runtimeSupportScope.permissionViews,
    accounts,
    approvals,
    transactions: sessionScope.controllersBase.transactions,
    namespaceBindings: runtimeSupportScope.namespaceBindings,
    dappConnections,
    providerProjection: {
      sessionStatus: sessionScope.sessionStatus,
      chainViews: sessionScope.chainViews,
    },
  });
  const services: WalletRuntimeServices = {
    attention: sessionScope.attention,
    chainActivation: sessionScope.chainActivation,
    chainViews: sessionScope.chainViews,
    permissionViews: runtimeSupportScope.permissionViews,
    accountCodecs: bootstrapScope.namespaceBootstrap.accountCodecs,
    networkSelection: sessionScope.networkSelection,
    customRpc: sessionScope.customRpc,
    namespaceBindings: runtimeSupportScope.namespaceBindings,
    namespaceRuntimeSupport: runtimeSupportScope.namespaceRuntimeSupport,
    session: sessionScope.sessionLayer.session,
    sessionStatus: sessionScope.sessionStatus,
    accountSigning: sessionScope.accountSigning,
    keyringExport: sessionScope.keyringExport,
    keyring: sessionScope.keyringService,
  };
  const runtimeCore: ArxWalletRuntimeCore = {
    bus: bootstrapScope.bus,
    controllers,
    services,
    surfaceErrors: surfaceErrorEncoder,
  };
  const provider = createWalletProvider({
    runtimeAccess: providerAccess,
    dappConnections,
    snapshots,
  });
  const createUi = (options: WalletCreateUiOptions) => createUiContract(createWalletUiDeps(runtimeCore, options));
  const createUiAccess = (options: WalletCreateUiOptions) =>
    createUiRuntimeAccess(createWalletUiDeps(runtimeCore, options));

  const wallet: ArxWallet = {
    namespaces,
    session,
    accounts,
    approvals,
    permissions,
    networks,
    transactions,
    attention,
    dappConnections,
    createProvider: () => provider,
    createUi,
    snapshots,
  };
  let shutdownPromise: Promise<void> | null = null;
  const shutdown = async () => {
    if (shutdownPromise) {
      await shutdownPromise;
      return;
    }

    shutdownPromise = (async () => {
      const pendingApprovalIds = sessionScope.controllersBase.approvals.getState().pending.map(({ id }) => id);

      await Promise.allSettled(
        pendingApprovalIds.map((id) =>
          sessionScope.controllersBase.approvals.cancel({
            id,
            reason: "session_lost",
          }),
        ),
      );

      cleanupTasks.splice(0).forEach((cleanup) => {
        try {
          cleanup();
        } catch {}
      });
      lifecycle.shutdown();
    })();

    await shutdownPromise;
  };

  const runtime: ArxWalletRuntime = {
    wallet,
    shutdown,
    bus: bootstrapScope.bus,
    controllers,
    services,
    lifecycle,
    rpc: {
      engine: sessionScope.engine,
      namespaceIndex: rpcRegistry,
      clients: runtimeSupportScope.rpcClientRegistry,
      resolveContextNamespace,
      resolveMethodNamespace,
      resolveInvocation,
      resolveInvocationDetails,
      executeRequest,
    },
    provider,
    providerAccess,
    createUiAccess,
    surfaceErrors: surfaceErrorEncoder,
  };

  return runtime;
};

export const createArxWalletRuntime = async (input: CreateArxWalletRuntimeInput): Promise<ArxWalletRuntime> => {
  const runtime = assembleArxWalletRuntime(input);

  if (input.runtime?.boot === false) {
    return runtime;
  }

  try {
    await bootWalletLifecycle(runtime.lifecycle);
    return runtime;
  } catch (error) {
    await runtime.shutdown();
    throw error;
  }
};

export const createArxWallet = async (input: CreateArxWalletInput): Promise<ArxWallet> => {
  const runtime = await createArxWalletRuntime(input);
  return runtime.wallet;
};
