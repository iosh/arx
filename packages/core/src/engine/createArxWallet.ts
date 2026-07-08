import { createApprovalDetails } from "../approvals/approvalDetails.js";
import { formatChainAddress } from "../chains/addressing.js";
import { OWNER_CHANGED } from "../events/ownerChanged.js";
import type { MethodExecutor } from "../invoke/methods.js";
import { assembleNamespaceStatic } from "../namespaces/index.js";
import {
  createRpcHintNamespaceResolver,
  createRpcMethodExecutor,
  createRpcMethodNamespaceResolver,
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
import { createTransactionServices, TransactionAggregateStore } from "../transactions/index.js";
import { createWalletSetupWorkflow } from "../wallet/actions/setupWorkflow.js";
import { createWalletApi, createWalletMethodExecutor, createWalletMethodHandlers } from "../wallet/createWalletApi.js";
import { WALLET_UI_CALLER_ORIGIN, type WalletApi, type WalletEvent } from "../wallet/index.js";
import { createWalletNamespaces } from "./namespaces.js";
import type { ArxWallet, CreateArxWalletInput, WalletProvider } from "./types.js";
import { resolveProviderChain as resolveProviderChainForConnection } from "./wallet/providerSnapshot.js";
import {
  createWalletAccounts,
  createWalletAttention,
  createWalletDappConnections,
  createWalletNetworks,
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

type WalletRuntimeServices = Readonly<
  BackgroundStateServices & {
    attention: BackgroundSessionScope["attention"];
    chainActivation: BackgroundSessionScope["chainActivation"];
    chainViews: BackgroundSessionScope["chainViews"];
    permissionViews: BackgroundSupportScope["permissionViews"];
    accountAddressing: BackgroundBootstrapScope["namespaceBootstrap"]["accountAddressing"];
    walletChainSelection: BackgroundSessionScope["walletChainSelection"];
    providerChainSelection: BackgroundSessionScope["providerChainSelection"];
    chainRpcDefaultEndpoints: BackgroundSessionScope["chainRpcDefaultEndpoints"];
    chainRpcEndpointOverrides: BackgroundSessionScope["chainRpcEndpointOverrides"];
    namespaceRuntime: BackgroundSupportScope["namespaceRuntime"];
    session: BackgroundSessionScope["sessionLayer"]["session"];
    accountSigning: BackgroundSessionScope["accountSigning"];
    keyring: BackgroundSessionScope["keyringService"];
  }
>;

type ArxWalletRuntimeCore = Readonly<{
  messenger: BackgroundBootstrapScope["messenger"];
  transactions: ReturnType<typeof createTransactionServices>["transactions"];
  transactionMonitor: ReturnType<typeof createTransactionServices>["monitor"];
  services: WalletRuntimeServices;
  setupWorkflow: ReturnType<typeof createWalletSetupWorkflow>;
}>;

export type CreateArxWalletRuntimeInput = CreateArxWalletInput &
  Readonly<{
    runtime?: Readonly<{
      boot?: boolean;
      lifecycleLabel?: string;
      assemblyOptions?: BackgroundAssemblyOptions;
      rpcClients?: RpcLayerOptions;
      rpcAccessPolicy?: BackgroundRpcAccessPolicyHooks;
      session?: SessionOptions;
      transactionRestartRecovery?: "run" | "skip";
    }>;
  }>;

type ArxWalletRuntime = Readonly<{
  wallet: ArxWallet;
  messenger: BackgroundBootstrapScope["messenger"];
  transactions: ReturnType<typeof createTransactionServices>["transactions"];
  transactionMonitor: ReturnType<typeof createTransactionServices>["monitor"];
  services: WalletRuntimeServices;
  lifecycle: RuntimeLifecycle;
  rpc: Readonly<{
    routing: BackgroundBootstrapScope["namespaceBootstrap"]["rpcRouting"];
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
  walletApi: WalletApi;
  createWalletMethodExecutor(options: WalletCreateWalletMethodExecutorOptions): MethodExecutor;
  subscribeWalletEvents(listener: (event: WalletEvent) => void): () => void;
}>;

type WalletCreateWalletMethodExecutorOptions = Readonly<{
  origin: string;
}>;

const bootWalletLifecycle = async (lifecycle: Pick<RuntimeLifecycle, "initialize" | "start">): Promise<void> => {
  await lifecycle.initialize();
  lifecycle.start();
};

const createWalletEvents = (runtime: ArxWalletRuntimeCore) => {
  return {
    subscribe: (listener: (event: WalletEvent) => void) => runtime.messenger.subscribe(OWNER_CHANGED, listener),
  };
};

export const assembleArxWalletRuntime = (input: CreateArxWalletRuntimeInput): ArxWalletRuntime => {
  const manifests = input.namespaces.manifests;
  if (manifests.length === 0) {
    throw new Error("createArxWallet requires at least one namespace manifest");
  }

  const namespaces = createWalletNamespaces({ manifests });
  const namespaceBootstrap = assembleNamespaceStatic(namespaces.listManifests());
  let sessionScope: BackgroundSessionScope | null = null;
  let backgroundSupportScope: BackgroundSupportScope | null = null;

  const assemblyOptions = input.runtime?.assemblyOptions;
  const runtimeRpcAccessPolicy = input.runtime?.rpcAccessPolicy ?? DEFAULT_RPC_ACCESS_POLICY;

  const bootstrapScope: BackgroundBootstrapScope = createBackgroundBootstrapScope({
    namespaceBootstrap,
    ...(input.storage.hydrate !== undefined ? { hydrate: input.storage.hydrate } : {}),
    ...(assemblyOptions?.approvals ? { approvalOptions: assemblyOptions.approvals } : {}),
    ...(assemblyOptions?.transactions ? { transactionOptions: assemblyOptions.transactions } : {}),
    chainDefinitionsOptions: {
      ...(assemblyOptions?.chainDefinitions ?? {}),
      port: input.storage.ports.chains.chainDefinitions,
    },
  });

  sessionScope = createBackgroundSessionScope({
    lifecycleLabel: input.runtime?.lifecycleLabel ?? "createArxWallet",
    bootstrapScope,
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
    ...(input.runtime?.session ? { sessionOptions: input.runtime.session } : {}),
  });

  backgroundSupportScope = createBackgroundSupportScope({
    bootstrapScope,
    sessionScope,
    ...(input.runtime?.rpcClients ? { rpcClientOptions: input.runtime.rpcClients } : {}),
  });
  const transactionAggregateStore = new TransactionAggregateStore({
    transactionsPort: input.storage.ports.transactions,
  });
  const transactionServices = createTransactionServices({
    aggregateStore: transactionAggregateStore,
    namespaces: backgroundSupportScope.namespaceTransactions,
    accountAddressing: bootstrapScope.namespaceBootstrap.accountAddressing,
    messenger: bootstrapScope.messenger,
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
  });
  const stateServices = sessionScope.stateServices;
  const rpcHandlerDeps: RpcHandlerDeps = {
    ...stateServices,
    walletChainSelection: sessionScope.walletChainSelection,
    chainActivation: sessionScope.chainActivation,
    chainRpcDefaultEndpoints: sessionScope.chainRpcDefaultEndpoints,
    chainAddressing: bootstrapScope.namespaceBootstrap.chainAddressing,
    permissionViews: backgroundSupportScope.permissionViews,
    namespaceRuntime: backgroundSupportScope.namespaceRuntime,
    transactions: transactionServices.transactions,
  };
  const rpcRouting = bootstrapScope.namespaceBootstrap.rpcRouting;
  const resolveMethodNamespace = createRpcMethodNamespaceResolver(rpcRouting);
  const resolveHintNamespace = createRpcHintNamespaceResolver(rpcRouting);
  const resolveInvocation = (method: string, hint?: Parameters<typeof resolveRpcInvocation>[3]) =>
    resolveRpcInvocation(rpcRouting, rpcHandlerDeps, method, hint);
  const resolveInvocationDetails = (method: string, hint?: Parameters<typeof resolveRpcInvocationDetails>[3]) =>
    resolveRpcInvocationDetails(rpcRouting, rpcHandlerDeps, method, hint);
  const executeRequest = createRpcMethodExecutor({
    routing: rpcRouting,
    deps: rpcHandlerDeps,
    chainRpcClientPool: backgroundSupportScope.chainRpcClientPool,
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
  const providerRequests = createProviderRequests();
  const providerAccess = createProviderRuntimeAccess({
    messenger: bootstrapScope.messenger,
    getIsInitialized: () => lifecycle.getIsInitialized(),
    getSessionStatus: () => sessionScope.sessionLayer.session.getStatus(),
    resolveProviderChain,
    initializeProviderChainSelection,
    listPermittedAccountsView: (origin, options) =>
      backgroundSupportScope.permissionViews.listPermittedAccounts(origin, options),
    formatAddress: (input) => formatChainAddress(bootstrapScope.namespaceBootstrap.chainAddressing, input),
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
    approvals: stateServices.approvals,
    providerRequests,
    subscribeSessionUnlocked: (listener) => sessionScope.sessionLayer.session.unlock.onUnlocked(listener),
    subscribeSessionLocked: (listener) => sessionScope.sessionLayer.session.unlock.onLocked(listener),
    subscribeChainRpcStateChanged: (listener) => stateServices.chainRpc.onStateChanged(listener),
    subscribeProviderChainSelectionChanged: (listener) =>
      sessionScope.providerChainSelection.subscribeChanged(listener),
    subscribeAccountsStateChanged: (listener) => stateServices.accounts.onStateChanged(listener),
    subscribePermissionsStateChanged: (listener) => stateServices.permissions.onStateChanged(listener),
  });
  const session = createWalletSession({
    session: sessionScope.sessionLayer.session,
    keyring: sessionScope.keyringService,
  });
  const accounts = createWalletAccounts({
    accounts: stateServices.accounts,
    keyring: sessionScope.keyringService,
  });
  const approvals = stateServices.approvals;
  const approvalDetails = createApprovalDetails({
    approvals: stateServices.approvals,
    accounts,
    chainViews: sessionScope.chainViews,
  });
  const permissions = stateServices.permissions;
  const networks = createWalletNetworks({
    walletChainSelection: sessionScope.walletChainSelection,
    chainDefinitions: stateServices.chainDefinitions,
    chainRpcEndpointOverrides: sessionScope.chainRpcEndpointOverrides,
    chainViews: sessionScope.chainViews,
    chainActivation: sessionScope.chainActivation,
    chainRpc: stateServices.chainRpc,
  });
  const attention = createWalletAttention({
    attention: sessionScope.attention,
  });
  const dappConnections = createWalletDappConnections({
    messenger: bootstrapScope.messenger,
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
    accountAddressing: bootstrapScope.namespaceBootstrap.accountAddressing,
    walletChainSelection: sessionScope.walletChainSelection,
    providerChainSelection: sessionScope.providerChainSelection,
    chainRpcDefaultEndpoints: sessionScope.chainRpcDefaultEndpoints,
    chainRpcEndpointOverrides: sessionScope.chainRpcEndpointOverrides,
    namespaceRuntime: backgroundSupportScope.namespaceRuntime,
    session: sessionScope.sessionLayer.session,
    accountSigning: sessionScope.accountSigning,
    keyring: sessionScope.keyringService,
  };
  const setupWorkflow = createWalletSetupWorkflow({
    vaultLifecycle: {
      createVaultWithSecret: async (params) => {
        await sessionScope.sessionLayer.session.createVaultWithSecret(params);
      },
      unlock: async (params) => {
        await sessionScope.sessionLayer.session.unlock.unlock(params);
      },
      persistVaultMetaSnapshot: () => sessionScope.sessionLayer.session.persistVaultMetaSnapshot(),
      clearVault: () => sessionScope.sessionLayer.session.clearVault(),
    },
    keyring: sessionScope.keyringService,
    accounts: stateServices.accounts,
    accountAddressing: bootstrapScope.namespaceBootstrap.accountAddressing,
  });
  const runtimeCore: ArxWalletRuntimeCore = {
    messenger: bootstrapScope.messenger,
    transactions: transactionServices.transactions,
    transactionMonitor: transactionServices.monitor,
    services,
    setupWorkflow,
  };
  const provider = createWalletProvider({
    runtimeAccess: providerAccess,
    dappConnections,
  });
  const walletEvents = createWalletEvents(runtimeCore);
  const buildWalletMethodHandlers = (options: WalletCreateWalletMethodExecutorOptions) =>
    createWalletMethodHandlers({
      session,
      accounts,
      networks,
      approvals,
      approvalDetails,
      attention,
      accountAddressing: bootstrapScope.namespaceBootstrap.accountAddressing,
      caller: {
        origin: options.origin,
      },
      namespaceRuntime: backgroundSupportScope.namespaceRuntime,
      transactions: transactionServices.transactions,
      setupWorkflow,
    });
  const buildWalletMethodExecutor = (options: WalletCreateWalletMethodExecutorOptions): MethodExecutor => {
    return createWalletMethodExecutor(buildWalletMethodHandlers(options));
  };
  const walletApi = createWalletApi(buildWalletMethodHandlers({ origin: WALLET_UI_CALLER_ORIGIN }));

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
  };

  const runtime: ArxWalletRuntime = {
    wallet,
    messenger: bootstrapScope.messenger,
    transactions: transactionServices.transactions,
    transactionMonitor: transactionServices.monitor,
    services,
    lifecycle,
    rpc: {
      routing: rpcRouting,
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
    createWalletMethodExecutor: buildWalletMethodExecutor,
    subscribeWalletEvents: walletEvents.subscribe,
  };

  return runtime;
};

export const createArxWalletRuntime = async (input: CreateArxWalletRuntimeInput): Promise<ArxWalletRuntime> => {
  const runtime = assembleArxWalletRuntime(input);

  if (input.runtime?.boot === false) {
    return runtime;
  }

  await bootWalletLifecycle(runtime.lifecycle);
  return runtime;
};

export const createArxWallet = async (input: CreateArxWalletInput): Promise<ArxWallet> => {
  const runtime = await createArxWalletRuntime(input);
  return runtime.wallet;
};
