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
import { ATTENTION_STATE_CHANGED } from "../services/runtime/attention/index.js";
import {
  buildTransactionTerminalReason,
  createTransactionServices,
  TransactionAggregateStore,
} from "../transactions/index.js";
import type { ApprovalDetail } from "../ui/protocol/models/approvals.js";
import { createUiContract, createUiRuntimeAccess } from "../ui/server/access.js";
import { createApprovalReadService } from "../ui/server/approvals/readService.js";
import { createApprovalResolveService } from "../ui/server/approvals/resolveService.js";
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
} from "./wallet.js";

type BackgroundBootstrapScope = ReturnType<typeof createBackgroundBootstrapScope>;
type BackgroundSessionScope = ReturnType<typeof createBackgroundSessionScope>;
type BackgroundSupportScope = ReturnType<typeof createBackgroundSupportScope>;
type RuntimeLifecycle = ReturnType<typeof createBackgroundRuntimeLifecycle>;

const DEFAULT_RPC_ACCESS_POLICY = {
  isInternalOrigin: () => false,
  shouldRequestUnlockAttention: () => false,
} satisfies BackgroundRpcAccessPolicyHooks;

type WalletRuntimeServices = Readonly<
  BackgroundStateServices & {
    attention: BackgroundSessionScope["attention"];
    chainActivation: BackgroundSessionScope["chainActivation"];
    chainViews: BackgroundSessionScope["chainViews"];
    permissionViews: BackgroundSupportScope["permissionViews"];
    accountCodecs: BackgroundBootstrapScope["namespaceBootstrap"]["accountCodecs"];
    networkSelection: BackgroundSessionScope["networkSelection"];
    customRpc: BackgroundSessionScope["customRpc"];
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
  services: WalletRuntimeServices;
  lifecycle: RuntimeLifecycle;
  rpc: Readonly<{
    namespaceIndex: BackgroundBootstrapScope["rpcRegistry"];
    clients: BackgroundSupportScope["rpcClientRegistry"];
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
  createUiAccess(options: WalletCreateUiOptions): UiRuntimeAccess;
  getApprovalDetail(approvalId: string): Promise<ApprovalDetail | null>;
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

const createWalletUiDeps = (
  runtime: ArxWalletRuntimeCore,
  approvalReadService: ReturnType<typeof createApprovalReadService>,
  approvalResolveService: ReturnType<typeof createApprovalResolveService>,
  options: WalletCreateUiOptions,
): UiRuntimeDeps => {
  const session = createUiSessionAccess({
    session: runtime.services.session,
    sessionStatus: runtime.services.sessionStatus,
    keyring: runtime.services.keyring,
  });

  return {
    server: {
      access: {
        accounts: runtime.services.accounts,
        approvals: {
          read: {
            listPendingEntries: () => approvalReadService.listPending(),
            getDetail: (id) => approvalReadService.getDetail(id),
          },
          write: {
            resolve: (input) => approvalResolveService.resolve(input),
          },
        },
        approvalEvents: runtime.services.approvals,
        permissions: {
          buildUiPermissionsSnapshot: () => runtime.services.permissionViews.buildUiPermissionsSnapshot(),
        },
        transactions: {
          requestTransactionApproval: (input) => runtime.transactions.requestTransactionApproval(input),
          rerunApprovalPrepare: (input) => runtime.transactions.rerunApprovalPrepare(input),
          updateApprovalDraft: (input) => runtime.transactions.updateApprovalDraft(input),
          approveAndSubmitTransaction: (input) => runtime.transactions.approveAndSubmitTransaction(input),
          rejectTransactionApproval: (input) => runtime.transactions.rejectTransactionApproval(input),
          getTransactionApproval: (approvalId) => runtime.transactions.getTransactionApproval(approvalId),
          getTransactionApprovalByTransactionId: (transactionId) =>
            runtime.transactions.getTransactionApprovalByTransactionId(transactionId),
          getTransaction: (transactionId) => runtime.transactions.getTransaction(transactionId),
          listTransactions: (query) => runtime.transactions.listTransactions(query),
          onTransactionsChanged: (handler) => runtime.transactions.onTransactionsChanged(handler),
          onTransactionApprovalsChanged: (handler) => runtime.transactions.onTransactionApprovalsChanged(handler),
        },
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
          accounts: runtime.services.accounts,
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
      persistVaultMeta: runtime.services.session.persistVaultMeta,
      stateChanged: {
        accounts: runtime.services.accounts,
        permissions: {
          onStateChanged: (listener) => runtime.services.permissions.onStateChanged(listener),
        },
        chains: {
          onStateChanged: (listener) => runtime.services.network.onStateChanged(listener),
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
  const cleanupTasks: Array<() => void> = [];
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
    ...(assemblyOptions?.network ? { networkOptions: assemblyOptions.network } : {}),
    ...(assemblyOptions?.approvals ? { approvalOptions: assemblyOptions.approvals } : {}),
    ...(assemblyOptions?.transactions ? { transactionOptions: assemblyOptions.transactions } : {}),
    supportedChainsOptions: {
      ...(assemblyOptions?.supportedChains ?? {}),
      port: input.storage.ports.chains.customChains,
    },
  });

  sessionScope = createBackgroundSessionScope({
    lifecycleLabel: input.runtime?.lifecycleLabel ?? "createArxWallet",
    bootstrapScope,
    namespaceSession: namespaceStages.session,
    settingsPort: input.storage.ports.settings,
    networkSelectionPort: input.storage.ports.chains.networkSelection,
    customRpcPort: input.storage.ports.chains.customRpc,
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
    permissionsReady: sessionScope.permissionsReady,
    deferredNetworkInitialState: sessionScope.deferredNetworkInitialState,
    registeredNamespaces: bootstrapScope.registeredNamespaces,
    transactionRecovery: transactionServices.recovery,
    transactionRestartRecovery: input.runtime?.transactionRestartRecovery ?? "run",
    networkBootstrap: backgroundSupportScope.networkBootstrap,
    sessionLayer: sessionScope.sessionLayer,
    rpcClientRegistry: backgroundSupportScope.rpcClientRegistry,
    bus: bootstrapScope.bus,
    logger: bootstrapScope.storageLogger,
  });
  const stateServices = sessionScope.stateServices;
  const rpcHandlerDeps: RpcHandlerDeps = {
    ...stateServices,
    networkSelection: sessionScope.networkSelection,
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
    rpcClientRegistry: backgroundSupportScope.rpcClientRegistry,
    services: {
      permissionViews: backgroundSupportScope.permissionViews,
      transactions: transactionServices.transactions,
    },
  });
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
    getActiveChainViewForNamespace: (namespace) => sessionScope.chainViews.getActiveChainViewForNamespace(namespace),
    buildProviderMeta: (namespace) => sessionScope.chainViews.buildProviderMeta(namespace),
    getActiveChainByNamespace: () => sessionScope.networkSelection.getChainRefByNamespace(),
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
    subscribeNetworkStateChanged: (listener) => stateServices.network.onStateChanged(listener),
    subscribeNetworkSelectionChanged: (listener) => sessionScope.networkSelection.subscribeChanged(() => listener()),
    subscribeAccountsStateChanged: (listener) => stateServices.accounts.onStateChanged(listener),
    subscribePermissionsStateChanged: (listener) => stateServices.permissions.onStateChanged(listener),
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
  const approvalResolveService = createApprovalResolveService({
    approvals: stateServices.approvals,
    transactions: transactionServices.transactions,
  });
  const permissions = createWalletPermissions({
    permissions: stateServices.permissions,
  });
  const networks = createWalletNetworks({
    networkSelection: sessionScope.networkSelection,
    supportedChains: stateServices.supportedChains,
    customRpc: sessionScope.customRpc,
    chainViews: sessionScope.chainViews,
    chainActivation: sessionScope.chainActivation,
    network: stateServices.network,
  });
  const attention = createWalletAttention({
    attention: sessionScope.attention,
  });
  const dappConnections = createWalletDappConnections({
    ...(input.env?.now ? { now: input.env.now } : {}),
    sessionStatus: sessionScope.sessionStatus,
    permissionViews: backgroundSupportScope.permissionViews,
    chainViews: sessionScope.chainViews,
    chainAddressCodecs: bootstrapScope.namespaceBootstrap.chainAddressCodecs,
    subscribeSessionLocked: (listener) => sessionScope.sessionLayer.session.unlock.onLocked(() => listener()),
    subscribeAccountsStateChanged: (listener) => stateServices.accounts.onStateChanged(() => listener()),
    subscribePermissionsStateChanged: (listener) => stateServices.permissions.onStateChanged(() => listener()),
    subscribeNetworkStateChanged: (listener) => stateServices.network.onStateChanged(() => listener()),
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
    permissionViews: backgroundSupportScope.permissionViews,
    accounts,
    approvals: {
      read: {
        listPendingEntries: () => approvalReadService.listPending(),
        getDetail: (id: string) => approvalReadService.getDetail(id),
      },
      write: {
        resolve: (input) => approvalResolveService.resolve(input),
      },
    },
    namespaceBindings: backgroundSupportScope.namespaceBindings,
    dappConnections,
    providerProjection: {
      sessionStatus: sessionScope.sessionStatus,
      chainViews: sessionScope.chainViews,
    },
  });
  const services: WalletRuntimeServices = {
    ...stateServices,
    attention: sessionScope.attention,
    chainActivation: sessionScope.chainActivation,
    chainViews: sessionScope.chainViews,
    permissionViews: backgroundSupportScope.permissionViews,
    accountCodecs: bootstrapScope.namespaceBootstrap.accountCodecs,
    networkSelection: sessionScope.networkSelection,
    customRpc: sessionScope.customRpc,
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
    services,
  };
  const provider = createWalletProvider({
    runtimeAccess: providerAccess,
    dappConnections,
    snapshots,
  });
  const createUi = (options: WalletCreateUiOptions) =>
    createUiContract(createWalletUiDeps(runtimeCore, approvalReadService, approvalResolveService, options));
  const createUiAccess = (options: WalletCreateUiOptions) =>
    createUiRuntimeAccess(createWalletUiDeps(runtimeCore, approvalReadService, approvalResolveService, options));

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
    snapshots,
  };
  let shutdownPromise: Promise<void> | null = null;
  const shutdown = async () => {
    if (shutdownPromise) {
      await shutdownPromise;
      return;
    }

    shutdownPromise = (async () => {
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
    transactions: transactionServices.transactions,
    services,
    lifecycle,
    rpc: {
      namespaceIndex: rpcRegistry,
      clients: backgroundSupportScope.rpcClientRegistry,
      resolveHintNamespace,
      resolveMethodNamespace,
      resolveInvocation,
      resolveInvocationDetails,
      executeRequest,
    },
    provider,
    providerAccess,
    createUiAccess,
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
