import { createApprovalExecutor, createApprovalFlowRegistry } from "../approvals/index.js";
import { createRpcRegistry } from "../rpc/index.js";
import { createBackgroundRuntimeLifecycle } from "../runtime/background/runtimeLifecyclePlan.js";
import {
  createRuntimeBootstrapScope,
  createRuntimeSessionScope,
  createRuntimeSupportScope,
} from "../runtime/background/runtimeScopes.js";
import { assembleRuntimeNamespaceStagesFromWalletModules } from "./modules/manifestInterop.js";
import { createWalletNamespaces } from "./namespaces.js";
import type { ArxWallet, CreateArxWalletInput } from "./types.js";
import {
  createWalletAttention,
  createWalletDappConnections,
  createWalletNetworks,
  createWalletPermissions,
  createWalletSession,
  createWalletSnapshots,
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

type ArxWalletRuntime = Readonly<{
  wallet: ArxWallet;
  shutdown(): Promise<void>;
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
  const session = createWalletSession({
    session: sessionScope.sessionLayer.session,
    sessionStatus: sessionScope.sessionStatus,
    keyring: sessionScope.keyringService,
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
    keyringExport: sessionScope.keyringExport,
    attention: sessionScope.attention,
    chainViews: sessionScope.chainViews,
    permissionViews: runtimeSupportScope.permissionViews,
    accounts: sessionScope.controllersBase.accounts,
    approvals: sessionScope.controllersBase.approvals,
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
    permissions,
    networks,
    attention,
    dappConnections,
    snapshots,
  };
  const shutdown = async () => {
    cleanupTasks.splice(0).forEach((cleanup) => {
      try {
        cleanup();
      } catch {}
    });
    lifecycle.shutdown();
  };

  try {
    await bootWalletLifecycle(lifecycle);
    return {
      wallet,
      shutdown,
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
