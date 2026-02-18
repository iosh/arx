import { createDefaultChainDescriptorRegistry } from "../chains/registry.js";
import { type CompareFn, ControllerMessenger } from "../messenger/ControllerMessenger.js";
import { EIP155_NAMESPACE } from "../rpc/handlers/namespaces/utils.js";
import type { HandlerControllers, Namespace } from "../rpc/handlers/types.js";
import { createRpcRegistry, type RpcInvocationContext, registerBuiltinRpcAdapters } from "../rpc/index.js";
import { createAccountsService } from "../services/accounts/AccountsService.js";
import type { AccountsPort } from "../services/accounts/port.js";
import { createApprovalsService } from "../services/approvals/ApprovalsService.js";
import type { ApprovalsPort } from "../services/approvals/port.js";
import { type AttentionServiceMessengerTopics, createAttentionService } from "../services/attention/index.js";
import { createKeyringMetasService } from "../services/keyringMetas/KeyringMetasService.js";
import type { KeyringMetasPort } from "../services/keyringMetas/port.js";
import { createNetworkPreferencesService } from "../services/networkPreferences/NetworkPreferencesService.js";
import type { NetworkPreferencesPort } from "../services/networkPreferences/port.js";
import { createPermissionsService } from "../services/permissions/PermissionsService.js";
import type { PermissionsPort } from "../services/permissions/port.js";
import type { SettingsPort } from "../services/settings/port.js";
import { createSettingsService } from "../services/settings/SettingsService.js";
import type { TransactionsPort } from "../services/transactions/port.js";
import { createTransactionsService } from "../services/transactions/TransactionsService.js";
import type { VaultMetaPort } from "../storage/index.js";
import { DEFAULT_CHAIN } from "./background/constants.js";
import { type ControllerLayerOptions, initControllers } from "./background/controllers.js";
import { type EngineOptions, initEngine } from "./background/engine.js";
import type { MessengerTopics } from "./background/messenger.js";
import { createNetworkBootstrap } from "./background/networkBootstrap.js";
import { registerDefaultTransactionAdapters } from "./background/registerDefaultTransactionAdapters.js";
import { initRpcLayer, type RpcLayerOptions } from "./background/rpcLayer.js";
import { createRuntimeLifecycle } from "./background/runtimeLifecycle.js";
import { initSessionLayer, type SessionOptions } from "./background/session.js";
import { createTransactionsLifecycle } from "./background/transactionsLifecycle.js";
import { AccountsKeyringBridge } from "./keyring/AccountsKeyringBridge.js";

export type { BackgroundSessionServices } from "./background/session.js";

export type CreateBackgroundServicesOptions = Omit<ControllerLayerOptions, "chainRegistry"> & {
  messenger?: {
    compare?: CompareFn<unknown>;
  };
  engine?: EngineOptions;
  networkPreferences: {
    port: NetworkPreferencesPort;
  };
  storage?: {
    vaultMetaPort?: VaultMetaPort;
    now?: () => number;
    hydrate?: boolean;
    logger?: (message: string, error?: unknown) => void;
  };
  store: {
    ports: {
      approvals: ApprovalsPort;
      transactions: TransactionsPort;
      accounts: AccountsPort;
      keyringMetas: KeyringMetasPort;
      permissions: PermissionsPort;
    };
  };
  chainRegistry: NonNullable<ControllerLayerOptions["chainRegistry"]>;
  settings?: {
    port: SettingsPort;
  };
  session?: SessionOptions;
  rpcClients?: RpcLayerOptions;
};

const castMessenger = <Topics extends Record<string, unknown>>(messenger: ControllerMessenger<MessengerTopics>) =>
  messenger as unknown as ControllerMessenger<Topics>;
export const createBackgroundServices = (options: CreateBackgroundServicesOptions) => {
  const rpcRegistry = createRpcRegistry();
  registerBuiltinRpcAdapters(rpcRegistry);

  const {
    messenger: messengerOptions,
    network: networkOptions,
    accounts: accountOptions,
    approvals: approvalOptions,
    permissions: permissionOptions,
    transactions: transactionOptions,
    engine: engineOptions,
    networkPreferences: networkPreferencesOptions,
    storage: storageOptions,
    store: storeOptions,
    settings: settingsOptions,
    session: sessionOptions,
    chainRegistry: chainRegistryOptions,
    rpcClients: rpcClientOptions,
  } = options;

  const messenger = new ControllerMessenger<MessengerTopics>(
    messengerOptions?.compare === undefined ? {} : { compare: messengerOptions.compare },
  );
  const chains = createDefaultChainDescriptorRegistry();

  let namespaceResolverFn: (context?: RpcInvocationContext) => Namespace = () => EIP155_NAMESPACE;
  const storageNow = storageOptions?.now ?? Date.now;
  const hydrationEnabled = storageOptions?.hydrate ?? true;
  const storageLogger = storageOptions?.logger ?? (() => {});

  const controllerOptions: ControllerLayerOptions = {
    ...(networkOptions ? { network: networkOptions } : {}),
    ...(accountOptions ? { accounts: accountOptions } : {}),
    ...(approvalOptions ? { approvals: { ...approvalOptions, logger: approvalOptions.logger ?? storageLogger } } : {}),
    ...(permissionOptions ? { permissions: { ...permissionOptions, chains } } : { permissions: { chains } }),
    ...(transactionOptions ? { transactions: transactionOptions } : {}),
    chainRegistry: chainRegistryOptions,
  };

  const settingsPort = settingsOptions?.port;
  const settingsService =
    settingsPort === undefined
      ? null
      : createSettingsService({
          port: settingsPort,
          now: storageNow,
        });

  const networkPreferences = createNetworkPreferencesService({
    port: networkPreferencesOptions.port,
    defaults: { activeChainRef: DEFAULT_CHAIN.chainRef },
    now: storageNow,
  });

  const approvalsService = createApprovalsService({
    port: storeOptions.ports.approvals,
    now: storageNow,
  });

  const transactionsService = createTransactionsService({
    port: storeOptions.ports.transactions,
    now: storageNow,
  });

  const permissionsService = createPermissionsService({
    port: storeOptions.ports.permissions,
    now: storageNow,
  });

  const accountsStore = createAccountsService({ port: storeOptions.ports.accounts });
  const keyringMetas = createKeyringMetasService({ port: storeOptions.ports.keyringMetas });

  const controllersInit = initControllers({
    messenger,
    namespaceResolver: (ctx) => namespaceResolverFn(ctx),
    rpcRegistry,
    accountsService: accountsStore,
    settingsService,
    approvalsService,
    permissionsService,
    transactionsService,
    options: controllerOptions,
  });

  const { controllersBase, transactionRegistry, networkController, chainRegistryController } = controllersInit;

  const rpcClientRegistry = initRpcLayer({
    controllers: controllersBase,
    ...(rpcClientOptions ? { rpcClientOptions } : {}),
  });

  const vaultMetaPort = storageOptions?.vaultMetaPort;
  const attention = createAttentionService({
    messenger: castMessenger<AttentionServiceMessengerTopics>(messenger),
    now: storageNow,
  });

  const runtimeLifecycle = createRuntimeLifecycle("createBackgroundServices");
  const sessionLayer = initSessionLayer({
    messenger,
    controllers: controllersBase,
    accountsStore,
    keyringMetas,
    storageLogger,
    storageNow,
    hydrationEnabled,
    getIsHydrating: () => runtimeLifecycle.getIsHydrating(),
    getIsDestroyed: () => runtimeLifecycle.getIsDestroyed(),
    ...(vaultMetaPort ? { vaultMetaPort } : {}),
    ...(sessionOptions ? { sessionOptions } : {}),
  });

  const engine = initEngine(engineOptions);

  const keyringService = sessionLayer.keyringService;
  const { signers } = registerDefaultTransactionAdapters({
    transactionRegistry,
    rpcClients: rpcClientRegistry,
    chains,
    keyring: keyringService,
  });

  const controllers: HandlerControllers = {
    ...controllersBase,
    networkPreferences,
    chains,
    signers,
  };

  namespaceResolverFn = rpcRegistry.createNamespaceResolver(controllers);

  const transactionsLifecycle = createTransactionsLifecycle({
    controller: controllers.transactions,
    service: transactionsService,
    unlock: sessionLayer.session.unlock,
    logger: storageLogger,
  });

  const accountsBridge = new AccountsKeyringBridge({
    keyring: keyringService,
    accounts: {
      switchActive: (params) => controllersBase.accounts.switchActive(params),
      getState: () => controllersBase.accounts.getState(),
    },
    logger: storageLogger,
  });
  const networkBootstrap = createNetworkBootstrap({
    network: networkController,
    chainRegistry: chainRegistryController,
    preferences: networkPreferences,
    hydrationEnabled,
    logger: storageLogger,
    getIsHydrating: () => runtimeLifecycle.getIsHydrating(),
  });

  const initialize = async () =>
    runtimeLifecycle.initialize(async () => {
      await chainRegistryController.whenReady();
      await controllersBase.permissions.whenReady();

      try {
        await approvalsService.expireAllPending({ finalStatusReason: "session_lost" });
      } catch (error) {
        storageLogger("approvals: failed to expire pending on initialize", error);
      }

      await transactionsLifecycle.initialize();

      await networkBootstrap.loadPreferences();

      await runtimeLifecycle.withHydration(async () => {
        networkBootstrap.requestSync();
        await sessionLayer.hydrateVaultMeta();
      });

      await networkBootstrap.flushPendingSync();
    });

  const start = () =>
    runtimeLifecycle.start(() => {
      networkBootstrap.start();
      sessionLayer.attachSessionListeners();
      transactionsLifecycle.start();
    });

  const destroy = () =>
    runtimeLifecycle.destroy(() => {
      transactionsLifecycle.destroy();
      sessionLayer.cleanupVaultPersistTimer();
      sessionLayer.detachSessionListeners();
      sessionLayer.destroySessionLayer();
      try {
        controllersBase.accounts.destroy?.();
      } catch (error) {
        storageLogger("lifecycle: failed to destroy accounts controller", error);
      }
      networkBootstrap.destroy();

      rpcClientRegistry.destroy();
      engine.destroy();
      messenger.clear();
    });

  return {
    messenger,
    attention,
    engine,
    controllers,
    session: sessionLayer.session,
    rpcClients: rpcClientRegistry,
    rpcRegistry,
    getActiveNamespace: namespaceResolverFn,
    lifecycle: {
      initialize,
      start,
      destroy,
    },
    keyring: keyringService,
    accountsRuntime: accountsBridge,
  };
};
