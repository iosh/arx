import type { Json, JsonRpcParams } from "@metamask/utils";
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

export const PermissionChecks = {
  None: "none",
  Connected: "connected",
  Scope: "scope",
} as const;
export type PermissionCheck = (typeof PermissionChecks)[keyof typeof PermissionChecks];

export type LockedPolicy = { allow: true } | { allow: false } | { response: Json };

export type MethodDefinition = {
  scope?: PermissionScope;
  /**
   * Permission guard mode.
   *
   * - "none": no permission check; the method must self-filter (e.g. return []).
   * - "connected": require Accounts connection for namespace+chainRef.
   * - "scope": require the method's scope via permissions.assertPermission.
   *
   * Default:
   * - if `scope` is present => "scope"
   * - otherwise => "none"
   */
  permissionCheck?: PermissionCheck;
  approvalRequired?: boolean;
  locked?: LockedPolicy;
  /**
   * Optional fast-fail validator for JSON-RPC params.
   * Throw ArxReasons.RpcInvalidParams when params are malformed.
   */
  validateParams?: (params: JsonRpcParams | undefined, context?: RpcInvocationContext) => void;
  handler: MethodHandler;
};

export type Namespace = string;

export type { PermissionScopeResolver };
