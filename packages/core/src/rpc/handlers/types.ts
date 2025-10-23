import type { JsonRpcParams } from "@metamask/utils";
import type { Caip2ChainId } from "../../chains/ids.js";
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

export type HandlerControllers = {
  network: NetworkController;
  accounts: AccountController;
  approvals: ApprovalController;
  permissions: PermissionController;
  transactions: TransactionController;
  chainRegistry: ChainRegistryController;
};

export type RpcRequest = {
  method: string;
  params?: JsonRpcParams;
};

export type RpcInvocationContext = {
  chainRef?: Caip2ChainId | null;
  namespace?: Namespace | null;
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
};

export type Namespace = string;

export type { PermissionScopeResolver };
