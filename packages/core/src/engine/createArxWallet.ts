import { createApprovalExecutor, createApprovalFlowRegistry } from "../approvals/index.js";
import type { ViolationMode } from "../messenger/Messenger.js";
import {
  createRpcHintNamespaceResolver,
  createRpcMethodExecutor,
  createRpcMethodNamespaceResolver,
  createRpcRegistry,
  type RpcHandlerDeps,
  resolveRpcInvocation,
  resolveRpcInvocationDetails,
} from "../rpc/index.js";
import type { BackgroundStateServices } from "../runtime/background/backgroundStateServices.js";
import type { BackgroundRpcAccessPolicyHooks } from "../runtime/background/rpcAccessPolicy.js";
import type { RpcLayerOptions } from "../runtime/background/rpcLayer.js";
import { createBackgroundRuntimeLifecycle } from "../runtime/background/runtimeLifecyclePlan.js";
import {
  type BackgroundAssemblyOptions,
  createBackgroundBootstrapScope,
  createBackgroundSessionScope,
  createBackgroundSupportScope,
} from "../runtime/background/runtimeScopes.js";
import type { SessionOptions } from "../runtime/background/session.js";
import { createProviderRuntimeAccess } from "../runtime/provider/createProviderRuntimeAccess.js";
import { createProviderRequests } from "../runtime/provider/providerRequests.js";
import type { ProviderRuntimeAccess } from "../runtime/provider/types.js";
import {
  buildTransactionTerminalReason,
  createTransactionServices,
  TransactionAggregateStore,
} from "../transactions/index.js";
import type { ApprovalDetail } from "../ui/protocol/models/approvals.js";
import { createUiContract, createUiRuntimeAccess } from "../ui/server/access.js";
import { createApprovalReadService } from "../ui/server/approvals/readService.js";
import type { UiRuntimeAccess, UiRuntimeDeps } from "../ui/server/types.js";
import type { WalletBridgeServer } from "../wallet/bridge/server.js";
import { createWalletBridgeServer as createWalletBridgeProtocolServer } from "../wallet/bridge/server.js";
import type { WalletApiContext } from "../wallet/context.js";
import { createTrustedWalletApi, createTrustedWalletMethodExecutor } from "../wallet/createTrustedWalletApi.js";
import type { TrustedWalletApi } from "../wallet/index.js";
import { assembleRuntimeNamespaceStagesFromWalletModules } from "./modules/manifestInterop.js";
import { createWalletNamespaces } from "./namespaces.js";
import type { ArxWallet, CreateArxWalletInput, WalletCreateUiOptions, WalletProvider } from "./types.js";
import { resolveProviderChain as resolveProviderChainForConnection } from "./wallet/providerSnapshot.js";
import {
  createWalletAccounts,
  createWalletApprovals,
  createWalletAttention,
  createWalletDappConnections,
  createWalletNetworks,
  createWalletPermissions,
  createWalletProvider,
  createWalletSession,
} from "./wallet.js";

type BackgroundBootstrapScope = ReturnType<typeof createBackgroundBootstrapScope>;
type BackgroundSessionScope = ReturnType<typeof createBackgroundSessionScope>;
type BackgroundSupportScope = ReturnType<typeof createBackgroundSupportScope>;
type RuntimeLifecycle = ReturnType<typeof createBackgroundRuntimeLifecycle>;

const DEFAULT_RPC_ACCESS_POLICY = {
  isInternalOrigin: () => false,
  shouldRequestUnlockAttention: () => false,
} satisfies BackgroundRpcAccessPolicyHooks;

const CORE_WALLET_API_ORIGIN = "arx://core-ui";

type WalletRuntimeServices = Readonly<
  BackgroundStateServices & {
    attention: BackgroundSessionScope["attention"];
    chainActivation: BackgroundSessionScope["chainActivation"];
    chainViews: BackgroundSessionScope["chainViews"];
    permissionViews: BackgroundSupportScope["permissionViews"];
    accountCodecs: BackgroundBootstrapScope["namespaceBootstrap"]["accountCodecs"];
    walletChainSelection: BackgroundSessionScope["walletChainSelection"];
    providerChainSelection: BackgroundSessionScope["providerChainSelection"];
    chainRpcDefaultEndpoints: BackgroundSessionScope["chainRpcDefaultEndpoints"];
    chainRpcEndpointOverrides: BackgroundSessionScope["chainRpcEndpointOverrides"];
    namespaceBindings: BackgroundSupportScope["namespaceBindings"];
    namespaceRuntimeSupport: BackgroundSupportScope["namespaceRuntimeSupport"];
    session: BackgroundSessionScope["sessionLayer"]["session"];
    sessionStatus: BackgroundSessionScope["sessionStatus"];
    accountSigning: BackgroundSessionScope["accountSigning"];
    keyringExport: BackgroundSessionScope["keyringExport"];
    keyring: BackgroundSessionScope["keyringService"];
  }
>;

type ArxWalletRuntimeCore = Readonly<{
  bus: BackgroundBootstrapScope["bus"];
  transactions: ReturnType<typeof createTransactionServices>["transactions"];
  transactionMonitor: ReturnType<typeof createTransactionServices>["monitor"];
  services: WalletRuntimeServices;
}>;

export type CreateArxWalletRuntimeInput = CreateArxWalletInput &
  Readonly<{
    runtime?: Readonly<{
      boot?: boolean;
      lifecycleLabel?: string;
      messenger?: Readonly<{
        violationMode?: ViolationMode;
      }>;
      assemblyOptions?: BackgroundAssemblyOptions;
      rpcClients?: RpcLayerOptions;
      rpcAccessPolicy?: BackgroundRpcAccessPolicyHooks;
      session?: SessionOptions;
      transactionRestartRecovery?: "run" | "skip";
    }>;
  }>;

type ArxWalletRuntime = Readonly<{
  wallet: ArxWallet;
  shutdown(): Promise<void>;
  bus: BackgroundBootstrapScope["bus"];
  transactions: ReturnType<typeof createTransactionServices>["transactions"];
  transactionMonitor: ReturnType<typeof createTransactionServices>["monitor"];
  services: WalletRuntimeServices;
  lifecycle: RuntimeLifecycle;
  rpc: Readonly<{
    namespaceIndex: BackgroundBootstrapScope["rpcRegistry"];
    clients: BackgroundSupportScope["chainRpcClientPool"];
    resolveHintNamespace: ReturnType<typeof createRpcHintNamespaceResolver>;
    resolveMethodNamespace: ReturnType<typeof createRpcMethodNamespaceResolver>;
    resolveInvocation: (
      method: string,
      hint?: Parameters<typeof resolveRpcInvocation>[3],
    ) => ReturnType<typeof resolveRpcInvocation>;
    resolveInvocationDetails: (
      method: string,
      hint?: Parameters<typeof resolveRpcInvocationDetails>[3],
    ) => ReturnType<typeof resolveRpcInvocationDetails>;
    executeRequest: ReturnType<typeof createRpcMethodExecutor>;
  }>;
  provider: WalletProvider;
  providerAccess: ProviderRuntimeAccess;
  walletApi: TrustedWalletApi;
  createUiAccess(options: WalletCreateUiOptions): UiRuntimeAccess;
  createWalletBridgeServer(options: WalletCreateWalletBridgeOptions): WalletBridgeServer;
  listPendingApprovals(): ReturnType<typeof createApprovalReadService>["listPending"] extends () => infer TResult
    ? Promise<Awaited<TResult>>
    : never;
  getApprovalDetail(approvalId: string): Promise<ApprovalDetail | null>;
}>;

type WalletCreateWalletBridgeOptions = Readonly<{
  uiOrigin: string;
  createId?: () => string;
}>;

const createUiTrustedWalletApi = (
  runtime: ArxWalletRuntimeCore,
  approvalReadService: ReturnType<typeof createApprovalReadService>,
  options: WalletCreateUiOptions,
): TrustedWalletApi => {
  return createTrustedWalletApi(
    createTrustedWalletApiContext(runtime, approvalReadService, {
      createId: options.createId ?? (() => globalThis.crypto.randomUUID()),
      origin: options.uiOrigin,
    }),
  );
};

const createTrustedWalletApiContext = (
  runtime: ArxWalletRuntimeCore,
  approvalReadService: ReturnType<typeof createApprovalReadService>,
  options: { createId: () => string; origin: string },
): WalletApiContext => {
  return {
    session: createWalletSession({
      session: runtime.services.session,
      sessionStatus: runtime.services.sessionStatus,
      keyring: runtime.services.keyring,
    }),
    accounts: createWalletAccounts({
      accounts: runtime.services.accounts,
      keyring: runtime.services.keyring,
      keyringExport: runtime.services.keyringExport,
    }),
    networks: createWalletNetworks({
      walletChainSelection: runtime.services.walletChainSelection,
      supportedChains: runtime.services.supportedChains,
      chainRpcEndpointOverrides: runtime.services.chainRpcEndpointOverrides,
      chainViews: runtime.services.chainViews,
      chainActivation: runtime.services.chainActivation,
      chainRpc: runtime.services.chainRpc,
    }),
    approvals: createWalletApprovals({
      approvals: runtime.services.approvals,
    }),
    approvalDetails: {
      listPending: () => approvalReadService.listPending(),
      getDetail: (approvalId) => approvalReadService.getDetail(approvalId),
    },
    accountCodecs: runtime.services.accountCodecs,
    createId: options.createId,
    surface: {
      origin: options.origin,
    },
    namespaceBindings: runtime.services.namespaceBindings,
    transactions: runtime.transactions,
  };
};

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

const createWalletUiDeps = (
  runtime: ArxWalletRuntimeCore,
  approvalReadService: ReturnType<typeof createApprovalReadService>,
  options: WalletCreateUiOptions,
): UiRuntimeDeps => {
  const wallet = createUiTrustedWalletApi(runtime, approvalReadService, options);

  return {
    server: {
      wallet,
      events: {
        onSessionChanged: (listener) => runtime.services.session.onStateChanged(listener),
        onApprovalCreated: (listener) => runtime.services.approvals.onCreated(() => listener()),
        onApprovalFinished: (listener) => runtime.services.approvals.onFinished(listener),
        onTransactionApprovalsChanged: (handler) => runtime.transactions.onTransactionApprovalsChanged(handler),
        onTransactionsChanged: (handler) => runtime.transactions.onTransactionsChanged(handler),
      },
      platform: options.platform,
      uiOrigin: options.uiOrigin,
      ...(options.createId ? { createId: options.createId } : {}),
      ...(options.extensions ? { extensions: options.extensions } : {}),
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
  let sessionScope: BackgroundSessionScope | null = null;
  let backgroundSupportScope: BackgroundSupportScope | null = null;

  const requireSessionScope = () => {
    if (!sessionScope) {
      throw new Error("Wallet session scope is not initialized");
    }
    return sessionScope;
  };

  const requireBackgroundSupportScope = () => {
    if (!backgroundSupportScope) {
      throw new Error("Wallet background support scope is not initialized");
    }
    return backgroundSupportScope;
  };

  const assemblyOptions = input.runtime?.assemblyOptions;
  const runtimeSessionOptions = buildRuntimeSessionOptions(input);
  const runtimeRpcAccessPolicy = input.runtime?.rpcAccessPolicy ?? DEFAULT_RPC_ACCESS_POLICY;
  const approvalFlowRegistry = createApprovalFlowRegistry();

  const bootstrapScope: BackgroundBootstrapScope = createBackgroundBootstrapScope({
    rpcRegistry,
    namespaceBootstrap: namespaceStages.bootstrap,
    ...(input.runtime?.messenger ? { messengerOptions: input.runtime.messenger } : {}),
    ...(storageOptions ? { storageOptions } : {}),
    ...(assemblyOptions?.approvals ? { approvalOptions: assemblyOptions.approvals } : {}),
    ...(assemblyOptions?.transactions ? { transactionOptions: assemblyOptions.transactions } : {}),
    supportedChainsOptions: {
      ...(assemblyOptions?.supportedChains ?? {}),
      port: input.storage.ports.chains.chainDefinitions,
    },
  });

  sessionScope = createBackgroundSessionScope({
    lifecycleLabel: input.runtime?.lifecycleLabel ?? "createArxWallet",
    bootstrapScope,
    namespaceSession: namespaceStages.session,
    settingsPort: input.storage.ports.settings,
    walletChainSelectionPort: input.storage.ports.chains.walletChainSelection,
    providerChainSelectionPort: input.storage.ports.chains.providerChainSelection,
    chainRpcDefaultEndpointsPort: input.storage.ports.chains.chainRpcDefaultEndpoints,
    chainRpcEndpointOverridesPort: input.storage.ports.chains.chainRpcEndpointOverrides,
    storePorts: {
      accounts: input.storage.ports.accounts,
      keyringMetas: input.storage.ports.keyrings,
      permissions: input.storage.ports.permissions,
    },
    vaultMetaPort: input.storage.ports.vault,
    ...(runtimeSessionOptions ? { sessionOptions: runtimeSessionOptions } : {}),
  });

  backgroundSupportScope = createBackgroundSupportScope({
    bootstrapScope,
    sessionScope,
    namespaceRuntimeSupport: namespaceStages.runtimeSupport,
    createApprovalExecutor: ({ stateServices }) =>
      createApprovalExecutor({
        registry: approvalFlowRegistry,
        getDeps: () => {
          const activeSessionScope = requireSessionScope();
          const activeBackgroundSupportScope = requireBackgroundSupportScope();

          return {
            accounts: stateServices.accounts,
            permissions: stateServices.permissions,
            chainActivation: activeSessionScope.chainActivation,
            supportedChains: stateServices.supportedChains,
            chainRpcDefaultEndpoints: activeSessionScope.chainRpcDefaultEndpoints,
            namespaceBindings: activeBackgroundSupportScope.namespaceBindings,
          };
        },
      }),
    ...(input.runtime?.rpcClients ? { rpcClientOptions: input.runtime.rpcClients } : {}),
  });
  const transactionAggregateStore = new TransactionAggregateStore({
    storage: input.storage.ports.transactions,
    now: bootstrapScope.storageNow,
    ...(input.env?.randomUuid ? { createId: input.env.randomUuid } : {}),
  });
  const transactionServices = createTransactionServices({
    aggregateStore: transactionAggregateStore,
    namespaces: backgroundSupportScope.namespaceTransactions,
    accountCodecs: bootstrapScope.namespaceBootstrap.accountCodecs,
    approvalSessionOptions: {
      now: bootstrapScope.storageNow,
      ...(input.env?.randomUuid ? { createId: input.env.randomUuid } : {}),
    },
  });

  const lifecycle = createBackgroundRuntimeLifecycle({
    runtimeLifecycle: sessionScope.runtimeLifecycle,
    stateServices: sessionScope.stateServices,
    providerChainSelection: sessionScope.providerChainSelection,
    hydrationEnabled: bootstrapScope.hydrationEnabled,
    permissionsReady: sessionScope.permissionsReady,
    transactionRecovery: transactionServices.recovery,
    submittedTransactionMonitor: transactionServices.monitor,
    transactionRestartRecovery: input.runtime?.transactionRestartRecovery ?? "run",
    chainRpcBootstrap: backgroundSupportScope.chainRpcBootstrap,
    sessionLayer: sessionScope.sessionLayer,
    bus: bootstrapScope.bus,
    logger: bootstrapScope.storageLogger,
  });
  const stateServices = sessionScope.stateServices;
  const rpcHandlerDeps: RpcHandlerDeps = {
    ...stateServices,
    walletChainSelection: sessionScope.walletChainSelection,
    chainRpcDefaultEndpoints: sessionScope.chainRpcDefaultEndpoints,
    chainAddressCodecs: bootstrapScope.namespaceBootstrap.chainAddressCodecs,
    clock: {
      now: bootstrapScope.storageNow,
    },
    signers: backgroundSupportScope.signers,
  };
  const resolveMethodNamespace = createRpcMethodNamespaceResolver(rpcRegistry);
  const resolveHintNamespace = createRpcHintNamespaceResolver(rpcRegistry);
  const resolveInvocation = (method: string, hint?: Parameters<typeof resolveRpcInvocation>[3]) =>
    resolveRpcInvocation(rpcRegistry, rpcHandlerDeps, method, hint);
  const resolveInvocationDetails = (method: string, hint?: Parameters<typeof resolveRpcInvocationDetails>[3]) =>
    resolveRpcInvocationDetails(rpcRegistry, rpcHandlerDeps, method, hint);
  const executeRequest = createRpcMethodExecutor({
    registry: rpcRegistry,
    deps: rpcHandlerDeps,
    chainRpcClientPool: backgroundSupportScope.chainRpcClientPool,
    services: {
      permissionViews: backgroundSupportScope.permissionViews,
      transactions: transactionServices.transactions,
    },
  });
  const resolveProviderChain = (input: { origin: string; namespace: string }) =>
    resolveProviderChainForConnection(
      {
        chainViews: sessionScope.chainViews,
        providerChainSelection: sessionScope.providerChainSelection,
      },
      input,
    );
  const initializeProviderChainSelection = async (input: { origin: string; namespace: string }) => {
    const selectedChainRef = sessionScope.providerChainSelection.getSelectedChainRef(input);
    if (selectedChainRef) {
      const selectedChain = sessionScope.chainViews.findAvailableChainView({
        namespace: input.namespace,
        chainRef: selectedChainRef,
      });
      if (selectedChain) {
        return;
      }

      await sessionScope.providerChainSelection.clear(input);
    }

    const activeChain = sessionScope.chainViews.getActiveChainViewForNamespace(input.namespace);
    await sessionScope.providerChainSelection.setSelectedChainRef({
      origin: input.origin,
      namespace: input.namespace,
      chainRef: activeChain.chainRef,
    });
  };
  const providerRequests = createProviderRequests({
    generateId: input.env?.randomUuid ?? (() => globalThis.crypto.randomUUID()),
    now: bootstrapScope.storageNow,
    cancelApproval: async ({ approvalId, reason }) => {
      const transaction = await transactionServices.transactions.cancelTransactionApproval({
        approvalId,
        reason: buildTransactionTerminalReason({
          kind: "approval_cancelled",
          code: `provider.${reason}`,
          message:
            reason === "caller_disconnected"
              ? "Provider caller disconnected before transaction approval completed."
              : "Provider request ended before transaction approval completed.",
          details: { reason },
        }),
      });
      if (transaction) {
        return;
      }
      await stateServices.approvals.cancel({ approvalId, reason });
    },
  });
  const providerAccess = createProviderRuntimeAccess({
    getIsInitialized: () => lifecycle.getIsInitialized(),
    getSessionStatus: () => sessionScope.sessionStatus.getStatus(),
    resolveProviderChain,
    initializeProviderChainSelection,
    listPermittedAccountsView: (origin, options) =>
      backgroundSupportScope.permissionViews.listPermittedAccounts(origin, options),
    formatAddress: (input) => bootstrapScope.namespaceBootstrap.chainAddressCodecs.formatAddress(input),
    resolveInvocationDetails,
    executeRequest,
    isInternalOrigin: runtimeRpcAccessPolicy.isInternalOrigin,
    ...(runtimeRpcAccessPolicy.shouldRequestUnlockAttention
      ? { shouldRequestUnlockAttention: runtimeRpcAccessPolicy.shouldRequestUnlockAttention }
      : {}),
    requestUnlockAttention: (args) => {
      sessionScope.attention.requestAttention({
        reason: "unlock_required",
        origin: args.origin,
        method: args.method,
        chainRef: args.chainRef,
        namespace: args.namespace,
      });
    },
    isAuthorized: (origin, options) =>
      backgroundSupportScope.permissionViews.getAuthorizationSnapshot(origin, {
        chainRef: options.chainRef,
      }).isAuthorized,
    providerRequests,
    subscribeSessionUnlocked: (listener) => sessionScope.sessionLayer.session.unlock.onUnlocked(listener),
    subscribeSessionLocked: (listener) => sessionScope.sessionLayer.session.unlock.onLocked(listener),
    subscribeChainRpcStateChanged: (listener) => stateServices.chainRpc.onStateChanged(listener),
    subscribeProviderChainSelectionChanged: (listener) =>
      sessionScope.providerChainSelection.subscribeChanged(listener),
    subscribeAccountsStateChanged: (listener) => stateServices.accounts.onStateChanged(listener),
    subscribePermissionsStateChanged: (listener) => stateServices.permissions.onStateChanged(listener),
    logger: bootstrapScope.storageLogger,
  });
  const session = createWalletSession({
    session: sessionScope.sessionLayer.session,
    sessionStatus: sessionScope.sessionStatus,
    keyring: sessionScope.keyringService,
  });
  const accounts = createWalletAccounts({
    accounts: stateServices.accounts,
    keyring: sessionScope.keyringService,
    keyringExport: sessionScope.keyringExport,
  });
  const approvals = createWalletApprovals({
    approvals: stateServices.approvals,
  });
  const approvalReadService = createApprovalReadService({
    approvals: stateServices.approvals,
    accounts,
    chainViews: sessionScope.chainViews,
    transactionApprovals: transactionServices.transactions,
  });
  const permissions = createWalletPermissions({
    permissions: stateServices.permissions,
  });
  const networks = createWalletNetworks({
    walletChainSelection: sessionScope.walletChainSelection,
    supportedChains: stateServices.supportedChains,
    chainRpcEndpointOverrides: sessionScope.chainRpcEndpointOverrides,
    chainViews: sessionScope.chainViews,
    chainActivation: sessionScope.chainActivation,
    chainRpc: stateServices.chainRpc,
  });
  const attention = createWalletAttention({
    attention: sessionScope.attention,
  });
  const dappConnections = createWalletDappConnections({
    ...(input.env?.now ? { now: input.env.now } : {}),
  });
  const syncDappConnectionFromProviderState = (
    input: { origin: string; namespace: string },
    state: Parameters<typeof dappConnections.record>[1],
  ) => {
    dappConnections.record(input, state);
  };
  providerAccess.subscribeConnectionStateChanged((change) => {
    if (change.changed.chain || change.changed.accounts) {
      syncDappConnectionFromProviderState(change.scope, change.next);
    }
  });
  const services: WalletRuntimeServices = {
    ...stateServices,
    attention: sessionScope.attention,
    chainActivation: sessionScope.chainActivation,
    chainViews: sessionScope.chainViews,
    permissionViews: backgroundSupportScope.permissionViews,
    accountCodecs: bootstrapScope.namespaceBootstrap.accountCodecs,
    walletChainSelection: sessionScope.walletChainSelection,
    providerChainSelection: sessionScope.providerChainSelection,
    chainRpcDefaultEndpoints: sessionScope.chainRpcDefaultEndpoints,
    chainRpcEndpointOverrides: sessionScope.chainRpcEndpointOverrides,
    namespaceBindings: backgroundSupportScope.namespaceBindings,
    namespaceRuntimeSupport: backgroundSupportScope.namespaceRuntimeSupport,
    session: sessionScope.sessionLayer.session,
    sessionStatus: sessionScope.sessionStatus,
    accountSigning: sessionScope.accountSigning,
    keyringExport: sessionScope.keyringExport,
    keyring: sessionScope.keyringService,
  };
  const runtimeCore: ArxWalletRuntimeCore = {
    bus: bootstrapScope.bus,
    transactions: transactionServices.transactions,
    transactionMonitor: transactionServices.monitor,
    services,
  };
  const provider = createWalletProvider({
    runtimeAccess: providerAccess,
    dappConnections,
  });
  const createUi = (options: WalletCreateUiOptions) =>
    createUiContract(createWalletUiDeps(runtimeCore, approvalReadService, options));
  const createUiAccess = (options: WalletCreateUiOptions) =>
    createUiRuntimeAccess(createWalletUiDeps(runtimeCore, approvalReadService, options));
  const createWalletBridgeServer = (options: WalletCreateWalletBridgeOptions): WalletBridgeServer => {
    const executor = createTrustedWalletMethodExecutor(
      createTrustedWalletApiContext(runtimeCore, approvalReadService, {
        createId: options.createId ?? (() => globalThis.crypto.randomUUID()),
        origin: options.uiOrigin,
      }),
    );

    return createWalletBridgeProtocolServer({ executor });
  };
  const walletApi = createTrustedWalletApi(
    createTrustedWalletApiContext(runtimeCore, approvalReadService, {
      createId: input.env?.randomUuid ?? (() => globalThis.crypto.randomUUID()),
      origin: CORE_WALLET_API_ORIGIN,
    }),
  );

  const wallet: ArxWallet = {
    namespaces,
    session,
    accounts,
    approvals,
    permissions,
    networks,
    attention,
    dappConnections,
    createProvider: () => provider,
    createUi,
  };
  let shutdownPromise: Promise<void> | null = null;
  const shutdown = async () => {
    if (shutdownPromise) {
      await shutdownPromise;
      return;
    }

    shutdownPromise = (async () => {
      lifecycle.shutdown();
    })();

    await shutdownPromise;
  };

  const runtime: ArxWalletRuntime = {
    wallet,
    shutdown,
    bus: bootstrapScope.bus,
    transactions: transactionServices.transactions,
    transactionMonitor: transactionServices.monitor,
    services,
    lifecycle,
    rpc: {
      namespaceIndex: rpcRegistry,
      clients: backgroundSupportScope.chainRpcClientPool,
      resolveHintNamespace,
      resolveMethodNamespace,
      resolveInvocation,
      resolveInvocationDetails,
      executeRequest,
    },
    provider,
    providerAccess,
    walletApi,
    createUiAccess,
    createWalletBridgeServer,
    listPendingApprovals: async () => await approvalReadService.listPending(),
    getApprovalDetail: async (approvalId) => await approvalReadService.getDetail(approvalId),
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
