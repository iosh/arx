import type { Json, JsonRpcParams } from "@metamask/utils";
import type { ZodType } from "zod";
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

type MethodHandlerContext<P> = {
  origin: string;
  request: RpcRequest;
  params: P;
  controllers: HandlerControllers;
  rpcContext?: RpcInvocationContext;
};

// Bivariant callback so narrower param types (e.g. `undefined`) can still be stored
// in registries typed as `MethodHandler<unknown>`. Params are validated/parsed
// before invocation, so this is safe in practice.
type BivariantCallback<Args extends unknown[], R> = { bivarianceHack(...args: Args): R }["bivarianceHack"];

export type MethodHandler<P = unknown> = BivariantCallback<[context: MethodHandlerContext<P>], Promise<unknown> | unknown>;

export const PermissionChecks = {
  None: "none",
  Connected: "connected",
  Scope: "scope",
} as const;
export type PermissionCheck = (typeof PermissionChecks)[keyof typeof PermissionChecks];

export type LockedPolicy = { allow: true } | { allow: false } | { response: Json };

export type MethodDefinition<P = unknown> = {
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
   * Optional zod schema for JSON-RPC params.
   *
   * If provided, it will be parsed once before handler execution and the
   * parsed value will be passed to the handler as `params`.
   */
  paramsSchema?: ZodType<P>;
  /**
   * Optional custom parser for params (useful when validation depends on rpcContext).
   * Prefer `paramsSchema` when possible.
   */
  parseParams?: (params: JsonRpcParams | undefined, context?: RpcInvocationContext) => P;
  handler: MethodHandler<P>;
};

export type Namespace = string;

export type { PermissionScopeResolver };
