import { DEFAULT_CHAIN_METADATA } from "../../chains/chains.seed.js";
import type { ChainMetadata } from "../../chains/metadata.js";
import type { ChainDescriptorRegistry } from "../../chains/registry.js";
import type { ChainRegistryPort } from "../../chains/registryPort.js";
import { StoreAccountsController } from "../../controllers/account/StoreAccountsController.js";
import { ACCOUNTS_TOPICS } from "../../controllers/account/topics.js";
import type { AccountController, MultiNamespaceAccountsState } from "../../controllers/account/types.js";
import { InMemoryApprovalController } from "../../controllers/approval/InMemoryApprovalController.js";
import { APPROVAL_TOPICS } from "../../controllers/approval/topics.js";
import type { ApprovalController } from "../../controllers/approval/types.js";
import { InMemoryChainRegistryController } from "../../controllers/chainRegistry/ChainRegistryController.js";
import { CHAIN_REGISTRY_TOPICS } from "../../controllers/chainRegistry/topics.js";
import type { ChainRegistryController } from "../../controllers/chainRegistry/types.js";
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
import type {
  PermissionController,
  PermissionScopeResolver,
  PermissionsState,
} from "../../controllers/permission/types.js";
import { StoreTransactionController } from "../../controllers/transaction/StoreTransactionController.js";
import { TRANSACTION_TOPICS } from "../../controllers/transaction/topics.js";
import type { TransactionController } from "../../controllers/transaction/types.js";
import type { Messenger } from "../../messenger/Messenger.js";
import type { Namespace } from "../../rpc/handlers/types.js";
import type { RpcInvocationContext, RpcRegistry } from "../../rpc/index.js";
import type { AccountsService } from "../../services/accounts/types.js";
import type { PermissionsService } from "../../services/permissions/types.js";
import type { SettingsService } from "../../services/settings/types.js";
import type { TransactionsService } from "../../services/transactions/types.js";
import { TransactionAdapterRegistry } from "../../transactions/adapters/registry.js";
import { DEFAULT_NETWORK_STATE_INPUT, DEFAULT_STRATEGY } from "./constants.js";

type NamespaceResolver = (context?: RpcInvocationContext) => Namespace;

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
    scopeResolver?: PermissionScopeResolver;
    chains?: ChainDescriptorRegistry;
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
  bus,
  namespaceResolver,
  rpcRegistry,
  accountsService,
  settingsService,
  permissionsService,
  transactionsService,
  options,
}: {
  bus: Messenger;
  namespaceResolver: NamespaceResolver;
  rpcRegistry: RpcRegistry;
  accountsService: AccountsService;
  settingsService: SettingsService;
  permissionsService: PermissionsService;
  transactionsService: TransactionsService;
  options: ControllerLayerOptions;
}): ControllersInitResult => {
  const {
    network: networkOptions,
    approvals: approvalOptions,
    permissions: permissionOptions,
    transactions: transactionOptions,
    chainRegistry: chainRegistryOptions,
  } = options;

  if (!chainRegistryOptions?.port) {
    throw new Error("createBackgroundServices requires chainRegistry.port");
  }

  const networkController = new InMemoryNetworkController({
    messenger: bus.scope({ name: "network", publish: NETWORK_TOPICS }),
    initialState: networkOptions?.initialState ?? DEFAULT_NETWORK_STATE_INPUT,
    defaultStrategy: networkOptions?.defaultStrategy ?? DEFAULT_STRATEGY,
    ...(networkOptions?.defaultCooldownMs !== undefined ? { defaultCooldownMs: networkOptions.defaultCooldownMs } : {}),
    ...(networkOptions?.now ? { now: networkOptions.now } : {}),
    ...(networkOptions?.logger ? { logger: networkOptions.logger } : {}),
  });

  const permissionScopeResolver =
    permissionOptions?.scopeResolver ?? rpcRegistry.createPermissionScopeResolver((ctx) => namespaceResolver(ctx));

  const accountController: AccountController = new StoreAccountsController({
    messenger: bus.scope({ name: "accounts", publish: ACCOUNTS_TOPICS }),
    accounts: accountsService,
    settings: settingsService,
  });

  const approvalController = new InMemoryApprovalController({
    messenger: bus.scope({ name: "approvals", publish: APPROVAL_TOPICS }),
    ...(approvalOptions?.autoRejectMessage !== undefined
      ? { autoRejectMessage: approvalOptions.autoRejectMessage }
      : {}),
    ...(approvalOptions?.ttlMs !== undefined ? { ttlMs: approvalOptions.ttlMs } : {}),
    ...(approvalOptions?.logger !== undefined ? { logger: approvalOptions.logger } : {}),
  });

  const permissionController = new StorePermissionController({
    messenger: bus.scope({ name: "permissions", publish: PERMISSION_TOPICS }),
    scopeResolver: permissionScopeResolver,
    service: permissionsService,
    ...(permissionOptions?.chains ? { chains: permissionOptions.chains } : {}),
  });

  const transactionRegistry = transactionOptions?.registry ?? new TransactionAdapterRegistry();

  const transactionController = new StoreTransactionController({
    messenger: bus.scope({ name: "transactions", publish: TRANSACTION_TOPICS }),
    network: {
      getActiveChain: () => networkController.getActiveChain(),
      getChain: (chainRef) => networkController.getChain(chainRef),
    },
    accounts: {
      getSelectedAddress: (params) => accountController.getSelectedAddress(params),
      getAccounts: (params) => accountController.getAccounts(params),
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
    messenger: bus.scope({ name: "chainRegistry", publish: CHAIN_REGISTRY_TOPICS }),
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
