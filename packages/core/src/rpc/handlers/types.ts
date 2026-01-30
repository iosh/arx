import type { JsonRpcParams } from "@metamask/utils";
import type { ChainRef } from "../../chains/ids.js";
import type { AccountController } from "../../controllers/account/types.js";
import type { ApprovalController } from "../../controllers/approval/types.js";
import type { ChainRegistryController } from "../../controllers/chainRegistry/types.js";
import type { NetworkController } from "../../controllers/network/types.js";
import type {
  PermissionController,
  PermissionScope,
  PermissionScopeResolver,
} from "../../controllers/permission/types.js";
import type { TransactionController } from "../../controllers/transaction/types.js";
import type { RequestContextRecord } from "../../db/records.js";
import type { Eip155Signer } from "../../transactions/adapters/eip155/signer.js";

export type HandlerControllers = {
  network: NetworkController;
  accounts: AccountController;
  approvals: ApprovalController;
  permissions: PermissionController;
  transactions: TransactionController;
  chainRegistry: ChainRegistryController;
  signers: {
    eip155: Eip155Signer;
  };
};

export type RpcRequest = {
  method: string;
  params?: JsonRpcParams;
};

export type RpcInvocationContext = {
  chainRef?: ChainRef | null;
  namespace?: Namespace | null;
  requestContext?: RequestContextRecord | null;
  meta?: unknown;
};

export type MethodHandler = (context: {
  origin: string;
  request: RpcRequest;
  controllers: HandlerControllers;
  rpcContext?: RpcInvocationContext;
}) => Promise<unknown> | unknown;

export type MethodDefinition = {
  scope?: PermissionScope;
  approvalRequired?: boolean;
  locked?: {
    allow?: boolean;
    response?: unknown;
  };
  handler: MethodHandler;
  /**
   * Whether this method is a "bootstrap" method that can run before permissions are granted.
   * Examples: eth_requestAccounts, wallet_requestPermissions
   * Default: false (requires permission if scope is present)
   */
  isBootstrap?: boolean;
};

export type Namespace = string;

export type { PermissionScopeResolver };
