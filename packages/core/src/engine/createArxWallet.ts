import { createApprovalExecutor, createApprovalFlowRegistry } from "../approvals/index.js";
import { createSurfaceErrorEncoder, type SurfaceErrorEncoder } from "../errors/index.js";
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
import {
  type BackgroundRpcEnvHooks,
  type BackgroundRpcRuntime,
  createRpcEngineForBackground,
} from "../runtime/background/rpcEngineAssembly.js";
import { createBackgroundRuntimeLifecycle } from "../runtime/background/runtimeLifecyclePlan.js";
import {
  createRuntimeBootstrapScope,
  createRuntimeSessionScope,
  createRuntimeSupportScope,
} from "../runtime/background/runtimeScopes.js";
import { createProviderRuntimeAccess } from "../runtime/provider/createProviderRuntimeAccess.js";
import type { ProviderRuntimeAccess } from "../runtime/provider/types.js";
import { assembleRuntimeNamespaceStagesFromWalletModules } from "./modules/manifestInterop.js";
import { createWalletNamespaces } from "./namespaces.js";
import type { ArxWallet, CreateArxWalletInput } from "./types.js";
import {
  createWalletAccounts,
  createWalletApprovals,
  createWalletAttention,
  createWalletDappConnections,
  createWalletNetworks,
  createWalletPermissions,
  createWalletSession,
  createWalletSnapshots,
  createWalletTransactions,
} from "./wallet.js";

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

const bootWalletLifecycle = async (
  lifecycle: Pick<ReturnType<typeof createBackgroundRuntimeLifecycle>, "initialize" | "start">,
): Promise<void> => {
  await lifecycle.initialize();
  lifecycle.start();
};

type RuntimeBootstrapScope = ReturnType<typeof createRuntimeBootstrapScope>;
type RuntimeSessionScope = ReturnType<typeof createRuntimeSessionScope>;
type RuntimeSupportScope = ReturnType<typeof createRuntimeSupportScope>;

const DEFAULT_RPC_ENV_HOOKS = {
  isInternalOrigin: () => false,
  shouldRequestUnlockAttention: () => false,
} satisfies BackgroundRpcEnvHooks;

type ArxWalletRuntime = Readonly<{
  wallet: ArxWallet;
  shutdown(): Promise<void>;
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
  providerAccess: ProviderRuntimeAccess;
  surfaceErrors: SurfaceErrorEncoder;
}>;

export const createArxWalletRuntime = async (input: CreateArxWalletInput): Promise<ArxWalletRuntime> => {
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

  const bootstrapScope: RuntimeBootstrapScope = createRuntimeBootstrapScope({
    rpcRegistry,
    namespaceBootstrap: namespaceStages.bootstrap,
    ...(storageOptions ? { storageOptions } : {}),
    chainDefinitionsOptions: {
      port: input.storage.ports.chainDefinitions,
    },
  });

  sessionScope = createRuntimeSessionScope({
    lifecycleLabel: "createArxWallet",
    bootstrapScope,
    namespaceSession: namespaceStages.session,
    settingsPort: input.storage.ports.settings,
    networkPreferencesPort: input.storage.ports.networkPreferences,
    storePorts: {
      accounts: input.storage.ports.accounts,
      keyringMetas: input.storage.ports.keyringMetas,
      permissions: input.storage.ports.permissions,
      transactions: input.storage.ports.transactions,
    },
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
            chainDefinitions: controllersBase.chainDefinitions,
            namespaceBindings: activeRuntimeSupportScope.namespaceBindings,
          };
        },
      }),
    ...(input.storage.vaultMetaPort ? { vaultMetaPort: input.storage.vaultMetaPort } : {}),
    ...(input.env?.randomUuid ? { sessionOptions: { uuid: input.env.randomUuid } } : {}),
  });

  runtimeSupportScope = createRuntimeSupportScope({
    bootstrapScope,
    sessionScope,
    namespaceRuntimeSupport: namespaceStages.runtimeSupport,
  });

  const lifecycle = createBackgroundRuntimeLifecycle({
    runtimeLifecycle: sessionScope.runtimeLifecycle,
    controllersBase: sessionScope.controllersBase,
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
    networkPreferences: sessionScope.networkPreferences,
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

  // Keep request middleware assembly shared so provider execution and error
  // handling stay on the same path.
  createRpcEngineForBackground(engineRuntime, DEFAULT_RPC_ENV_HOOKS);

  const providerAccess = createProviderRuntimeAccess({
    getSessionStatus: () => sessionScope.sessionStatus.getStatus(),
    getActiveChainViewForNamespace: (namespace) => sessionScope.chainViews.getActiveChainViewForNamespace(namespace),
    buildProviderMeta: (namespace) => sessionScope.chainViews.buildProviderMeta(namespace),
    getActiveChainByNamespace: () => sessionScope.networkPreferences.getActiveChainByNamespace(),
    listPermittedAccountsView: (origin, options) =>
      runtimeSupportScope.permissionViews.listPermittedAccounts(origin, options),
    formatAddress: (input) => bootstrapScope.namespaceBootstrap.chainAddressCodecs.formatAddress(input),
    resolveMethodNamespace,
    handleRpcRequest: (request, callback) => sessionScope.engine.handle(request, callback),
    encodeDappError: (error, context) => surfaceErrorEncoder.encodeDapp(error, context) as JsonRpcError,
    cancelSessionApprovals: async (input) =>
      await sessionScope.controllersBase.approvals.cancelByScope({
        scope: {
          transport: "provider",
          origin: input.origin,
          portId: input.portId,
          sessionId: input.sessionId,
        },
        reason: "session_lost",
      }),
    subscribeSessionUnlocked: (listener) => sessionScope.sessionLayer.session.unlock.onUnlocked(listener),
    subscribeSessionLocked: (listener) => sessionScope.sessionLayer.session.unlock.onLocked(listener),
    subscribeNetworkStateChanged: (listener) => sessionScope.controllersBase.network.onStateChanged(listener),
    subscribeNetworkPreferencesChanged: (listener) => sessionScope.networkPreferences.subscribeChanged(listener),
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
    permissionViews: runtimeSupportScope.permissionViews,
  });
  const networks = createWalletNetworks({
    networkPreferences: sessionScope.networkPreferences,
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
    subscribeNetworkPreferencesChanged: (listener) =>
      sessionScope.networkPreferences.subscribeChanged(() => listener()),
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

  try {
    await bootWalletLifecycle(lifecycle);
    return {
      wallet,
      shutdown,
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
      providerAccess,
      surfaceErrors: surfaceErrorEncoder,
    };
  } catch (error) {
    await shutdown();
    throw error;
  }
};

export const createArxWallet = async (input: CreateArxWalletInput): Promise<ArxWallet> => {
  const runtime = await createArxWalletRuntime(input);
  return runtime.wallet;
};
