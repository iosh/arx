import type { AccountCodecRegistry } from "../../accounts/addressing/codec.js";
import type { ApprovalExecutor } from "../../approvals/types.js";
import type { ChainMetadata } from "../../chains/metadata.js";
import { StoreAccountsController } from "../../controllers/account/StoreAccountsController.js";
import { ACCOUNTS_TOPICS } from "../../controllers/account/topics.js";
import type { AccountController, MultiNamespaceAccountsState } from "../../controllers/account/types.js";
import { InMemoryApprovalController } from "../../controllers/approval/InMemoryApprovalController.js";
import { APPROVAL_TOPICS } from "../../controllers/approval/topics.js";
import type { ApprovalController } from "../../controllers/approval/types.js";
import { buildNetworkRuntimeInput } from "../../controllers/network/config.js";
import { InMemoryNetworkController } from "../../controllers/network/NetworkController.js";
import { NETWORK_TOPICS } from "../../controllers/network/topics.js";
import type {
  NetworkController,
  NetworkStateInput,
  RpcEventLogger,
  RpcStrategyConfig,
} from "../../controllers/network/types.js";
import { PermissionsController } from "../../controllers/permission/PermissionsController.js";
import { PERMISSION_TOPICS } from "../../controllers/permission/topics.js";
import type { PermissionsEvents, PermissionsReader, PermissionsWriter } from "../../controllers/permission/types.js";
import { InMemorySupportedChainsController } from "../../controllers/supportedChains/SupportedChainsController.js";
import { SUPPORTED_CHAINS_TOPICS } from "../../controllers/supportedChains/topics.js";
import type { SupportedChainsController } from "../../controllers/supportedChains/types.js";
import { StoreTransactionController } from "../../controllers/transaction/StoreTransactionController.js";
import { TRANSACTION_TOPICS } from "../../controllers/transaction/topics.js";
import type { TransactionController } from "../../controllers/transaction/types.js";
import type { Messenger } from "../../messenger/Messenger.js";
import type { AccountsService } from "../../services/store/accounts/types.js";
import type { CustomChainsPort } from "../../services/store/customChains/port.js";
import type { NetworkSelectionService } from "../../services/store/networkSelection/types.js";
import type { PermissionsPort } from "../../services/store/permissions/port.js";
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
  transactions?: {
    registry?: TransactionAdapterRegistry;
  };
  supportedChains?: {
    port: CustomChainsPort;
    seed?: ChainMetadata[];
    now?: () => number;
    logger?: (message: string, error?: unknown) => void;
  };
};

export type ControllersBase = {
  network: NetworkController;
  accounts: AccountController;
  approvals: ApprovalController;
  permissions: PermissionsReader & PermissionsWriter & PermissionsEvents;
  transactions: TransactionController;
  supportedChains: SupportedChainsController;
};

export type ControllersInitResult = {
  controllersBase: ControllersBase;
  transactionRegistry: TransactionAdapterRegistry;
  networkController: NetworkController;
  supportedChainsController: SupportedChainsController;
  permissionsController: PermissionsController;
  permissionsReady: Promise<void>;
  deferredNetworkInitialState: NetworkStateInput | null;
};

export const initControllers = ({
  bus,
  accountCodecs,
  accountsService,
  settingsService,
  permissionsPort,
  transactionsService,
  networkSelection,
  networkPlan,
  options,
  createApprovalExecutor,
}: {
  bus: Messenger;
  accountCodecs: AccountCodecRegistry;
  accountsService: AccountsService;
  settingsService: SettingsService;
  permissionsPort: PermissionsPort;
  transactionsService: TransactionsService;
  networkSelection: Pick<NetworkSelectionService, "getSelectedChainRef">;
  networkPlan: RuntimeNetworkPlan;
  options: ControllerLayerOptions;
  createApprovalExecutor?: (controllersBase: ControllersBase) => ApprovalExecutor | undefined;
}): ControllersInitResult => {
  const {
    network: networkOptions,
    approvals: approvalOptions,
    transactions: transactionOptions,
    supportedChains: supportedChainsOptions,
  } = options;

  if (!supportedChainsOptions?.port) {
    throw new Error("createBackgroundRuntime requires supportedChains.port");
  }

  const supportedChainSeed: ChainMetadata[] = (supportedChainsOptions.seed ?? []).map((entry) => ({ ...entry }));

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

  const permissionsController = new PermissionsController({
    messenger: bus.scope({ name: "permissions", publish: PERMISSION_TOPICS }),
    port: permissionsPort,
  });
  const permissionsReady = permissionsController.waitForHydration();

  const transactionRegistry = transactionOptions?.registry ?? new TransactionAdapterRegistry();

  const supportedChainsController = new InMemorySupportedChainsController({
    messenger: bus.scope({ name: "supportedChains", publish: SUPPORTED_CHAINS_TOPICS }),
    port: supportedChainsOptions.port,
    seed: supportedChainSeed,
    ...(supportedChainsOptions.now ? { now: supportedChainsOptions.now } : {}),
    ...(supportedChainsOptions.logger ? { logger: supportedChainsOptions.logger } : {}),
  });

  const transactionController = new StoreTransactionController({
    messenger: bus.scope({ name: "transactions", publish: TRANSACTION_TOPICS }),
    accountCodecs,
    networkSelection,
    supportedChains: {
      getChain: (chainRef) => supportedChainsController.getChain(chainRef),
    },
    accounts: {
      getActiveAccountForNamespace: (params) => accountController.getActiveAccountForNamespace(params),
      listOwnedForNamespace: (params) => accountController.listOwnedForNamespace(params),
    },
    approvals: {
      create: (request, requester) => approvalController.create(request, requester),
      onFinished: (handler) => approvalController.onFinished(handler),
    },
    registry: transactionRegistry,
    service: transactionsService,
    ...(networkOptions?.now ? { now: networkOptions.now } : {}),
  });

  const controllersBase: ControllersBase = {
    network: networkController,
    accounts: accountController,
    approvals: approvalController,
    permissions: permissionsController,
    transactions: transactionController,
    supportedChains: supportedChainsController,
  };

  approvalExecutor = createApprovalExecutor?.(controllersBase);

  return {
    controllersBase,
    transactionRegistry,
    networkController,
    supportedChainsController,
    permissionsController,
    permissionsReady,
    deferredNetworkInitialState: networkPlan.deferredState,
  };
};
