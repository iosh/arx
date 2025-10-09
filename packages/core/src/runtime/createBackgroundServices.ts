import { JsonRpcEngine, type JsonRpcMiddleware } from "@metamask/json-rpc-engine";
import type { Json, JsonRpcParams } from "@metamask/utils";
import { InMemoryAccountController } from "../controllers/account/AccountController.js";
import type {
  AccountController,
  AccountMessenger,
  AccountMessengerTopics,
  AccountsState,
} from "../controllers/account/types.js";
import { InMemoryApprovalController } from "../controllers/approval/ApprovalController.js";
import type {
  ApprovalController,
  ApprovalMessenger,
  ApprovalMessengerTopics,
  ApprovalState,
} from "../controllers/approval/types.js";
import type { UnlockMessengerTopics } from "../controllers/index.js";
import { InMemoryNetworkController } from "../controllers/network/NetworkController.js";
import type {
  NetworkController,
  NetworkMessenger,
  NetworkMessengerTopic,
  NetworkState,
} from "../controllers/network/types.js";
import { InMemoryPermissionController } from "../controllers/permission/PermissionController.js";
import type {
  PermissionController,
  PermissionMessenger,
  PermissionMessengerTopics,
  PermissionScopeResolver,
  PermissionsState,
} from "../controllers/permission/types.js";
import { InMemoryTransactionController } from "../controllers/transaction/TransactionController.js";
import type {
  TransactionController,
  TransactionMessenger,
  TransactionMessengerTopics,
  TransactionState,
} from "../controllers/transaction/types.js";
import { type CompareFn, ControllerMessenger } from "../messenger/ControllerMessenger.js";
import { EIP155_NAMESPACE } from "../rpc/handlers/namespaces/utils.js";
import { createPermissionScopeResolver } from "../rpc/index.js";
import type { StoragePort } from "../storage/index.js";
import { registerStorageSync } from "./persistence/registerStorageSync.js";

type MessengerTopics = AccountMessengerTopics &
  ApprovalMessengerTopics &
  NetworkMessengerTopic &
  PermissionMessengerTopics &
  TransactionMessengerTopics &
  UnlockMessengerTopics;

const DEFAULT_CHAIN: NetworkState["active"] = {
  caip2: "eip155:1",
  chainId: "0x1",
  rpcUrl: "https://eth.llamarpc.com",
  name: "Ethereum Mainnet",
  nativeCurrency: {
    name: "Ether",
    symbol: "ETH",
    decimals: 18,
  },
};

const DEFAULT_KNOWN_CHAINS: NetworkState["knownChains"] = [DEFAULT_CHAIN];

const DEFAULT_NETWORK_STATE: NetworkState = {
  active: DEFAULT_CHAIN,
  knownChains: DEFAULT_KNOWN_CHAINS,
};

const DEFAULT_ACCOUNTS_STATE: AccountsState = {
  all: [],
  primary: null,
};
const DEFAULT_PERMISSIONS_STATE: PermissionsState = {
  origins: {},
};

export type CreateBackgroundServicesOptions = {
  messenger?: {
    compare?: CompareFn<unknown>;
  };
  network?: {
    initialState?: NetworkState;
  };
  accounts?: {
    initialState?: AccountsState;
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
    autoApprove?: boolean;
    autoRejectMessage?: string;
    initialState?: TransactionState;
  };
  engine?: {
    middlewares?: JsonRpcMiddleware<JsonRpcParams, Json>[];
  };
  storage?: {
    port: StoragePort;
    now?: () => number;
  };
};

const castMessenger = <Topics extends Record<string, unknown>>(messenger: ControllerMessenger<MessengerTopics>) =>
  messenger as unknown as ControllerMessenger<Topics>;
export const createBackgroundServices = (options?: CreateBackgroundServicesOptions) => {
  const {
    messenger: messengerOptions,
    network: networkOptions,
    accounts: accountOptions,
    approvals: approvalOptions,
    permissions: permissionOptions,
    transactions: transactionOptions,
    engine: engineOptions,
    storage: storageOptions,
  } = options ?? {};

  const subscriptions: Array<() => void> = [];
  const storagePort = storageOptions?.port;
  const resolveNow = storageOptions?.now ?? Date.now;

  const messenger = new ControllerMessenger<MessengerTopics>(
    messengerOptions?.compare === undefined ? {} : { compare: messengerOptions.compare },
  );
  const networkController = new InMemoryNetworkController({
    messenger: castMessenger<NetworkMessengerTopic>(messenger) as NetworkMessenger,
    initialState: networkOptions?.initialState ?? DEFAULT_NETWORK_STATE,
  });

  const resolveNamespace = () => {
    const active = networkController.getState().active;
    const [namespace] = active.caip2.split(":");
    return namespace ?? EIP155_NAMESPACE;
  };

  const permissionScopeResolver = permissionOptions?.scopeResolver ?? createPermissionScopeResolver(resolveNamespace);

  const accountController = new InMemoryAccountController({
    messenger: castMessenger<AccountMessengerTopics>(messenger) as AccountMessenger,
    initialState: accountOptions?.initialState ?? DEFAULT_ACCOUNTS_STATE,
  });

  const approvalController = new InMemoryApprovalController({
    messenger: castMessenger<ApprovalMessengerTopics>(messenger) as ApprovalMessenger,
    ...(approvalOptions?.autoRejectMessage !== undefined
      ? { autoRejectMessage: approvalOptions.autoRejectMessage }
      : {}),
    ...(approvalOptions?.initialState !== undefined ? { initialState: approvalOptions.initialState } : {}),
  });

  const permissionController = new InMemoryPermissionController({
    messenger: castMessenger<PermissionMessengerTopics>(messenger) as PermissionMessenger,
    initialState: permissionOptions?.initialState ?? DEFAULT_PERMISSIONS_STATE,
    scopeResolver: permissionOptions?.scopeResolver ?? (() => undefined),
  });

  const transactionController = new InMemoryTransactionController({
    messenger: castMessenger<TransactionMessengerTopics>(messenger) as TransactionMessenger,
    network: {
      getState: () => networkController.getState(),
    },
    accounts: {
      getPrimaryAccount: () => accountController.getPrimaryAccount(),
    },
    approvals: {
      requestApproval: (...args) => approvalController.requestApproval(...args),
    },
    ...(transactionOptions?.autoApprove !== undefined ? { autoApprove: transactionOptions.autoApprove } : {}),
    ...(transactionOptions?.autoRejectMessage !== undefined
      ? { autoRejectMessage: transactionOptions.autoRejectMessage }
      : {}),
    ...(transactionOptions?.initialState !== undefined ? { initialState: transactionOptions.initialState } : {}),
  });

  const engine = new JsonRpcEngine();
  const middlewares = engineOptions?.middlewares ?? [];

  if (middlewares.length > 0) {
    middlewares.forEach((middleware) => {
      engine.push(middleware);
    });
  }

  const controllers: {
    network: NetworkController;
    accounts: AccountController;
    approvals: ApprovalController;
    permissions: PermissionController;
    transactions: TransactionController;
  } = {
    network: networkController,
    accounts: accountController,
    approvals: approvalController,
    permissions: permissionController,
    transactions: transactionController,
  };

  const detachPersistence =
    storagePort === undefined
      ? undefined
      : registerStorageSync({
          storage: storagePort,
          controllers: {
            approvals: approvalController,
            transactions: transactionController,
          },
          now: resolveNow,
          logger: (message, error) => {
            console.warn("[createBackgroundServices]", message, error);
          },
        });

  return {
    messenger,
    engine,
    controllers,
    lifecycle: {
      start: () => {
        // bind platform bridge events
      },
      destroy: () => {
        if (detachPersistence) {
          detachPersistence();
        }
        engine.destroy();
        messenger.clear();
      },
    },
  };
};

export type CreateBackgroundServicesResult = ReturnType<typeof createBackgroundServices>;
