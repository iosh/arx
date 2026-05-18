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
import { createTransactionRuntime } from "../../controllers/transaction/createTransactionRuntime.js";
import { TRANSACTION_TOPICS } from "../../controllers/transaction/topics.js";
import type { TransactionRuntime } from "../../controllers/transaction/types.js";
import type { Messenger } from "../../messenger/Messenger.js";
import type { AccountsService } from "../../services/store/accounts/types.js";
import type { CustomChainsPort } from "../../services/store/customChains/port.js";
import type { PermissionsPort } from "../../services/store/permissions/port.js";
import type { SettingsService } from "../../services/store/settings/types.js";
import type { TransactionsService } from "../../services/store/transactions/types.js";
import type { NamespaceTransactions } from "../../transactions/namespace/NamespaceTransactions.js";
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
    namespaces?: NamespaceTransactions;
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
  supportedChains: SupportedChainsController;
};

export type ControllersInitResult = {
  controllersBase: ControllersBase;
  networkController: NetworkController;
  supportedChainsController: SupportedChainsController;
  permissionsController: PermissionsController;
  permissionsReady: Promise<void>;
  deferredNetworkInitialState: NetworkStateInput | null;
  setApprovalExecutor(executor: ApprovalExecutor | undefined): void;
};

export const createTransactionRuntimeForControllers = (params: {
  bus: Messenger;
  accountCodecs: AccountCodecRegistry;
  accounts: AccountController;
  approvals: ApprovalController;
  namespaces: NamespaceTransactions;
  transactionsService: TransactionsService;
  now?: () => number;
}): TransactionRuntime => {
  return createTransactionRuntime({
    messenger: params.bus.scope({ name: "transactions", publish: TRANSACTION_TOPICS }),
    accountCodecs: params.accountCodecs,
    accounts: {
      listOwnedForNamespace: (input) => params.accounts.listOwnedForNamespace(input),
    },
    approvals: {
      create: (...args) => params.approvals.create(...args),
      createPending: (...args) => params.approvals.createPending(...args),
      cancel: (input) => params.approvals.cancel(input),
      onFinished: (handler) => params.approvals.onFinished(handler),
      listPendingIdsBySubject: (subject) => params.approvals.listPendingIdsBySubject(subject),
    },
    namespaces: params.namespaces,
    service: params.transactionsService,
    ...(params.now ? { now: params.now } : {}),
  });
};

export const initControllers = ({
  bus,
  accountCodecs,
  accountsService,
  settingsService,
  permissionsPort,
  networkPlan,
  options,
}: {
  bus: Messenger;
  accountCodecs: AccountCodecRegistry;
  accountsService: AccountsService;
  settingsService: SettingsService;
  permissionsPort: PermissionsPort;
  networkPlan: RuntimeNetworkPlan;
  options: ControllerLayerOptions;
}): ControllersInitResult => {
  const { network: networkOptions, approvals: approvalOptions, supportedChains: supportedChainsOptions } = options;

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

  const supportedChainsController = new InMemorySupportedChainsController({
    messenger: bus.scope({ name: "supportedChains", publish: SUPPORTED_CHAINS_TOPICS }),
    port: supportedChainsOptions.port,
    seed: supportedChainSeed,
    ...(supportedChainsOptions.now ? { now: supportedChainsOptions.now } : {}),
    ...(supportedChainsOptions.logger ? { logger: supportedChainsOptions.logger } : {}),
  });

  const controllersBase: ControllersBase = {
    network: networkController,
    accounts: accountController,
    approvals: approvalController,
    permissions: permissionsController,
    supportedChains: supportedChainsController,
  };

  return {
    controllersBase,
    networkController,
    supportedChainsController,
    permissionsController,
    permissionsReady,
    deferredNetworkInitialState: networkPlan.deferredState,
    setApprovalExecutor(executor) {
      approvalExecutor = executor;
    },
  };
};
