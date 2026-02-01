import { DEFAULT_CHAIN_METADATA } from "../../chains/chains.seed.js";
import type { ChainMetadata } from "../../chains/metadata.js";
import type { ChainRegistryPort } from "../../chains/registryPort.js";
import { InMemoryMultiNamespaceAccountsController } from "../../controllers/account/MultiNamespaceAccountsController.js";
import type {
  AccountController,
  AccountMessenger,
  AccountMessengerTopics,
  MultiNamespaceAccountsState,
} from "../../controllers/account/types.js";
import { StoreApprovalController } from "../../controllers/approval/StoreApprovalController.js";
import type {
  ApprovalController,
  ApprovalMessenger,
  ApprovalMessengerTopics,
  ApprovalState,
} from "../../controllers/approval/types.js";
import { InMemoryChainRegistryController } from "../../controllers/chainRegistry/ChainRegistryController.js";
import type {
  ChainRegistryController,
  ChainRegistryMessenger,
  ChainRegistryMessengerTopics,
} from "../../controllers/chainRegistry/types.js";
import { InMemoryNetworkController } from "../../controllers/network/NetworkController.js";
import type {
  NetworkController,
  NetworkMessenger,
  NetworkMessengerTopic,
  NetworkState,
  RpcEventLogger,
  RpcStrategyConfig,
} from "../../controllers/network/types.js";
import { StorePermissionController } from "../../controllers/permission/StorePermissionController.js";
import type {
  PermissionController,
  PermissionMessenger,
  PermissionMessengerTopics,
  PermissionScopeResolver,
  PermissionsState,
} from "../../controllers/permission/types.js";
import { StoreTransactionController } from "../../controllers/transaction/StoreTransactionController.js";
import type {
  TransactionController,
  TransactionMessenger,
  TransactionMessengerTopics,
} from "../../controllers/transaction/types.js";
import type { Namespace } from "../../rpc/handlers/types.js";
import { createPermissionScopeResolver, type RpcInvocationContext } from "../../rpc/index.js";
import type { ApprovalsService } from "../../services/approvals/types.js";
import type { PermissionsService } from "../../services/permissions/types.js";
import type { TransactionsService } from "../../services/transactions/types.js";
import { TransactionAdapterRegistry } from "../../transactions/adapters/registry.js";
import {
  DEFAULT_ACCOUNTS_STATE,
  DEFAULT_NETWORK_STATE,
  DEFAULT_PERMISSIONS_STATE,
  DEFAULT_STRATEGY,
} from "./constants.js";
import type { BackgroundMessenger } from "./messenger.js";
import { castMessenger } from "./messenger.js";

type NamespaceResolver = (context?: RpcInvocationContext) => Namespace;

export type ControllerLayerOptions = {
  network?: {
    initialState?: NetworkState;
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
    initialState?: ApprovalState;
  };
  permissions?: {
    initialState?: PermissionsState;
    scopeResolver?: PermissionScopeResolver;
  };
  transactions?: {
    registry?: TransactionAdapterRegistry;
  };
  chainRegistry?: {
    port: ChainRegistryPort;
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
  chainRegistry: ChainRegistryController;
};

export type ControllersInitResult = {
  controllersBase: ControllersBase;
  transactionRegistry: TransactionAdapterRegistry;
  networkController: NetworkController;
  chainRegistryController: ChainRegistryController;
  permissionController: PermissionController;
};

export const initControllers = ({
  messenger,
  namespaceResolver,
  approvalsService,
  permissionsService,
  transactionsService,
  options,
}: {
  messenger: BackgroundMessenger;
  namespaceResolver: NamespaceResolver;
  approvalsService: ApprovalsService;
  permissionsService: PermissionsService;
  transactionsService: TransactionsService;
  options: ControllerLayerOptions;
}): ControllersInitResult => {
  const {
    network: networkOptions,
    accounts: accountOptions,
    approvals: approvalOptions,
    permissions: permissionOptions,
    transactions: transactionOptions,
    chainRegistry: chainRegistryOptions,
  } = options;

  if (!chainRegistryOptions?.port) {
    throw new Error("createBackgroundServices requires chainRegistry.port");
  }

  const networkController = new InMemoryNetworkController({
    messenger: castMessenger<NetworkMessengerTopic>(messenger) as NetworkMessenger,
    initialState: networkOptions?.initialState ?? DEFAULT_NETWORK_STATE,
    defaultStrategy: networkOptions?.defaultStrategy ?? DEFAULT_STRATEGY,
    ...(networkOptions?.defaultCooldownMs !== undefined ? { defaultCooldownMs: networkOptions.defaultCooldownMs } : {}),
    ...(networkOptions?.now ? { now: networkOptions.now } : {}),
    ...(networkOptions?.logger ? { logger: networkOptions.logger } : {}),
  });

  const permissionScopeResolver =
    permissionOptions?.scopeResolver ?? createPermissionScopeResolver((ctx) => namespaceResolver(ctx));

  const accountController = new InMemoryMultiNamespaceAccountsController({
    messenger: castMessenger<AccountMessengerTopics>(messenger) as AccountMessenger,
    initialState: accountOptions?.initialState ?? DEFAULT_ACCOUNTS_STATE,
  });

  const approvalController = new StoreApprovalController({
    messenger: castMessenger<ApprovalMessengerTopics>(messenger) as ApprovalMessenger,
    service: approvalsService,
  });

  const permissionController = new StorePermissionController({
    messenger: castMessenger<PermissionMessengerTopics>(messenger) as PermissionMessenger,
    scopeResolver: permissionScopeResolver,
    service: permissionsService,
  });

  const transactionRegistry = transactionOptions?.registry ?? new TransactionAdapterRegistry();

  const transactionController = new StoreTransactionController({
    messenger: castMessenger<TransactionMessengerTopics>(messenger) as TransactionMessenger,
    network: {
      getActiveChain: () => networkController.getActiveChain(),
      getChain: (chainRef) => networkController.getChain(chainRef),
    },
    accounts: {
      getActivePointer: () => accountController.getActivePointer(),
    },
    approvals: {
      requestApproval: (task, requestContext) => approvalController.requestApproval(task, requestContext),
    },
    registry: transactionRegistry,
    service: transactionsService,
    ...(networkOptions?.now ? { now: networkOptions.now } : {}),
  });

  const seedSource = chainRegistryOptions.seed ?? DEFAULT_CHAIN_METADATA;
  const registrySeed: ChainMetadata[] = seedSource.map((entry) => ({ ...entry }));

  const chainRegistryController = new InMemoryChainRegistryController({
    messenger: castMessenger<ChainRegistryMessengerTopics>(messenger) as ChainRegistryMessenger,
    port: chainRegistryOptions.port,
    seed: registrySeed,
    ...(chainRegistryOptions.now ? { now: chainRegistryOptions.now } : {}),
    ...(chainRegistryOptions.logger ? { logger: chainRegistryOptions.logger } : {}),
    ...(chainRegistryOptions.schemaVersion !== undefined ? { schemaVersion: chainRegistryOptions.schemaVersion } : {}),
  });

  const controllersBase: ControllersBase = {
    network: networkController,
    accounts: accountController,
    approvals: approvalController,
    permissions: permissionController,
    transactions: transactionController,
    chainRegistry: chainRegistryController,
  };

  return {
    controllersBase,
    transactionRegistry,
    networkController,
    chainRegistryController,
    permissionController,
  };
};
