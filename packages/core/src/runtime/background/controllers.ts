import type { AccountCodecRegistry } from "../../accounts/addressing/codec.js";
import type { ApprovalExecutor } from "../../approvals/types.js";
import type { ChainMetadata } from "../../chains/metadata.js";
import type { ChainAddressCodecRegistry } from "../../chains/registry.js";
import { StoreAccountsController } from "../../controllers/account/StoreAccountsController.js";
import { ACCOUNTS_TOPICS } from "../../controllers/account/topics.js";
import type { AccountController, MultiNamespaceAccountsState } from "../../controllers/account/types.js";
import { InMemoryApprovalController } from "../../controllers/approval/InMemoryApprovalController.js";
import { APPROVAL_TOPICS } from "../../controllers/approval/topics.js";
import type { ApprovalController } from "../../controllers/approval/types.js";
import { InMemoryChainDefinitionsController } from "../../controllers/chainDefinitions/ChainDefinitionsController.js";
import { CHAIN_DEFINITIONS_TOPICS } from "../../controllers/chainDefinitions/topics.js";
import type { ChainDefinitionsController } from "../../controllers/chainDefinitions/types.js";
import { buildNetworkRuntimeInput } from "../../controllers/network/config.js";
import { InMemoryNetworkController } from "../../controllers/network/NetworkController.js";
import { NETWORK_TOPICS } from "../../controllers/network/topics.js";
import type {
  NetworkController,
  NetworkStateInput,
  RpcEventLogger,
  RpcStrategyConfig,
} from "../../controllers/network/types.js";
import { StorePermissionController } from "../../controllers/permission/StorePermissionController.js";
import { PERMISSION_TOPICS } from "../../controllers/permission/topics.js";
import type { PermissionController, PermissionsState } from "../../controllers/permission/types.js";
import { StoreTransactionController } from "../../controllers/transaction/StoreTransactionController.js";
import { TRANSACTION_TOPICS } from "../../controllers/transaction/topics.js";
import type { TransactionController } from "../../controllers/transaction/types.js";
import type { Messenger } from "../../messenger/Messenger.js";
import type { AccountsService } from "../../services/store/accounts/types.js";
import type { ChainDefinitionsPort } from "../../services/store/chainDefinitions/port.js";
import type { NetworkPreferencesService } from "../../services/store/networkPreferences/types.js";
import type { PermissionsService } from "../../services/store/permissions/types.js";
import type { SettingsService } from "../../services/store/settings/types.js";
import type { TransactionsService } from "../../services/store/transactions/types.js";
import { TransactionAdapterRegistry } from "../../transactions/adapters/registry.js";
import { DEFAULT_STRATEGY } from "./constants.js";
import type { RuntimeNetworkPlan } from "./networkDefaults.js";

export type ControllerLayerOptions = {
  network?: {
    initialState?: NetworkStateInput;
    defaultStrategy?: RpcStrategyConfig;
    defaultCooldownMs?: number;
    now?: () => number;
    logger?: RpcEventLogger;
  };
  accounts?: {
    initialState?: MultiNamespaceAccountsState;
  };
  approvals?: {
    autoRejectMessage?: string;
    ttlMs?: number;
    logger?: (message: string, error?: unknown) => void;
  };
  permissions?: {
    initialState?: PermissionsState;
    chains?: ChainAddressCodecRegistry;
  };
  transactions?: {
    registry?: TransactionAdapterRegistry;
  };
  chainDefinitions?: {
    port: ChainDefinitionsPort;
    seed?: ChainMetadata[];
    now?: () => number;
    logger?: (message: string, error?: unknown) => void;
    schemaVersion?: number;
  };
};

export type ControllersBase = {
  network: NetworkController;
  accounts: AccountController;
  approvals: ApprovalController;
  permissions: PermissionController;
  transactions: TransactionController;
  chainDefinitions: ChainDefinitionsController;
};

export type ControllersInitResult = {
  controllersBase: ControllersBase;
  transactionRegistry: TransactionAdapterRegistry;
  networkController: NetworkController;
  chainDefinitionsController: ChainDefinitionsController;
  permissionController: PermissionController;
  deferredNetworkInitialState: NetworkStateInput | null;
};

export const initControllers = ({
  bus,
  accountCodecs,
  accountsService,
  settingsService,
  permissionsService,
  transactionsService,
  networkPreferences,
  networkPlan,
  options,
  createApprovalExecutor,
}: {
  bus: Messenger;
  accountCodecs: AccountCodecRegistry;
  accountsService: AccountsService;
  settingsService: SettingsService;
  permissionsService: PermissionsService;
  transactionsService: TransactionsService;
  networkPreferences: Pick<NetworkPreferencesService, "getActiveChainRef">;
  networkPlan: RuntimeNetworkPlan;
  options: ControllerLayerOptions;
  createApprovalExecutor?: (controllersBase: ControllersBase) => ApprovalExecutor | undefined;
}): ControllersInitResult => {
  const {
    network: networkOptions,
    approvals: approvalOptions,
    transactions: transactionOptions,
    chainDefinitions: chainDefinitionsOptions,
  } = options;

  if (!chainDefinitionsOptions?.port) {
    throw new Error("createBackgroundRuntime requires chainDefinitions.port");
  }

  const registrySeed: ChainMetadata[] = (chainDefinitionsOptions.seed ?? []).map((entry) => ({ ...entry }));

  const networkController = new InMemoryNetworkController({
    messenger: bus.scope({ name: "network", publish: NETWORK_TOPICS }),
    initialRuntime: buildNetworkRuntimeInput(networkPlan.bootstrapState, networkPlan.admittedChains),
    defaultStrategy: networkOptions?.defaultStrategy ?? DEFAULT_STRATEGY,
    ...(networkOptions?.defaultCooldownMs !== undefined ? { defaultCooldownMs: networkOptions.defaultCooldownMs } : {}),
    ...(networkOptions?.now ? { now: networkOptions.now } : {}),
    ...(networkOptions?.logger ? { logger: networkOptions.logger } : {}),
  });

  const accountController: AccountController = new StoreAccountsController({
    messenger: bus.scope({ name: "accounts", publish: ACCOUNTS_TOPICS }),
    accounts: accountsService,
    settings: settingsService,
    accountCodecs,
  });

  let approvalExecutor: ApprovalExecutor | undefined;

  const approvalController = new InMemoryApprovalController({
    messenger: bus.scope({ name: "approvals", publish: APPROVAL_TOPICS }),
    ...(approvalOptions?.autoRejectMessage !== undefined
      ? { autoRejectMessage: approvalOptions.autoRejectMessage }
      : {}),
    ...(approvalOptions?.ttlMs !== undefined ? { ttlMs: approvalOptions.ttlMs } : {}),
    ...(approvalOptions?.logger !== undefined ? { logger: approvalOptions.logger } : {}),
    getExecutor: () => approvalExecutor,
  });

  const permissionController = new StorePermissionController({
    messenger: bus.scope({ name: "permissions", publish: PERMISSION_TOPICS }),
    service: permissionsService,
  });

  const transactionRegistry = transactionOptions?.registry ?? new TransactionAdapterRegistry();

  const transactionController = new StoreTransactionController({
    messenger: bus.scope({ name: "transactions", publish: TRANSACTION_TOPICS }),
    accountCodecs,
    networkPreferences,
    chainDefinitions: {
      getChain: (chainRef) => chainDefinitionsController.getChain(chainRef),
    },
    accounts: {
      getActiveAccountForNamespace: (params) => accountController.getActiveAccountForNamespace(params),
      listOwnedForNamespace: (params) => accountController.listOwnedForNamespace(params),
    },
    approvals: {
      create: (request, requester) => approvalController.create(request, requester),
    },
    registry: transactionRegistry,
    service: transactionsService,
    ...(networkOptions?.now ? { now: networkOptions.now } : {}),
  });

  const chainDefinitionsController = new InMemoryChainDefinitionsController({
    messenger: bus.scope({ name: "chainDefinitions", publish: CHAIN_DEFINITIONS_TOPICS }),
    port: chainDefinitionsOptions.port,
    seed: registrySeed,
    ...(chainDefinitionsOptions.now ? { now: chainDefinitionsOptions.now } : {}),
    ...(chainDefinitionsOptions.logger ? { logger: chainDefinitionsOptions.logger } : {}),
    ...(chainDefinitionsOptions.schemaVersion !== undefined
      ? { schemaVersion: chainDefinitionsOptions.schemaVersion }
      : {}),
  });

  const controllersBase: ControllersBase = {
    network: networkController,
    accounts: accountController,
    approvals: approvalController,
    permissions: permissionController,
    transactions: transactionController,
    chainDefinitions: chainDefinitionsController,
  };

  approvalExecutor = createApprovalExecutor?.(controllersBase);

  return {
    controllersBase,
    transactionRegistry,
    networkController,
    chainDefinitionsController,
    permissionController,
    deferredNetworkInitialState: networkPlan.deferredState,
  };
};
