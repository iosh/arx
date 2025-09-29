import type { JsonRpcParams } from "@metamask/utils";
import type { AccountController } from "../../controllers/account/types.js";
import type { ApprovalController } from "../../controllers/approval/types.js";
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
};

export type RpcRequest = {
  method: string;
  params?: JsonRpcParams;
};

export type MethodHandler = (context: {
  origin: string;
  request: RpcRequest;
  controllers: HandlerControllers;
}) => Promise<unknown> | unknown;

export type MethodDefinition = {
  scope?: PermissionScope;
  approvalRequired?: boolean;
  handler: MethodHandler;
};

export type Namespace = string;

export type { PermissionScopeResolver };
