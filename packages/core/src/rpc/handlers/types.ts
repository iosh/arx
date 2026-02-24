import type { Json, JsonRpcParams } from "@metamask/utils";
import type { ZodType } from "zod";
import type { ChainRef } from "../../chains/ids.js";
import type { ChainDescriptorRegistry } from "../../chains/registry.js";
import type { AccountController } from "../../controllers/account/types.js";
import type { ApprovalController } from "../../controllers/approval/types.js";
import type { ChainRegistryController } from "../../controllers/chainRegistry/types.js";
import type { NetworkController } from "../../controllers/network/types.js";
import type {
  PermissionCapability,
  PermissionCapabilityResolver,
  PermissionController,
} from "../../controllers/permission/types.js";
import type { TransactionController } from "../../controllers/transaction/types.js";
import type { NetworkPreferencesService } from "../../services/networkPreferences/types.js";
import type { Eip155Signer } from "../../transactions/adapters/eip155/signer.js";
import type { RequestContext } from "../requestContext.js";
import { NoParamsSchema } from "./params.js";

export type HandlerControllers = {
  network: NetworkController;
  networkPreferences: NetworkPreferencesService;
  accounts: AccountController;
  approvals: ApprovalController;
  permissions: PermissionController;
  transactions: TransactionController;
  chainRegistry: ChainRegistryController;
  chains: ChainDescriptorRegistry;
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
  requestContext?: RequestContext | null;
  meta?: unknown;
};

type MethodHandlerContext<P> = {
  origin: string;
  request: RpcRequest;
  params: P;
  controllers: HandlerControllers;
  invocation: { namespace: Namespace; chainRef: ChainRef };
  rpcContext?: RpcInvocationContext;
};

// Bivariant callback so narrower param types (e.g. `undefined`) can still be stored
// in registries typed as `MethodHandler<unknown>`. Params are validated/parsed
// before invocation, so this is safe in practice.
type BivariantCallback<Args extends unknown[], R> = { bivarianceHack(...args: Args): R }["bivarianceHack"];

export type MethodHandler<P = unknown> = BivariantCallback<
  [context: MethodHandlerContext<P>],
  Promise<unknown> | unknown
>;

export const PermissionChecks = {
  None: "none",
  Connected: "connected",
  Scope: "scope",
} as const;
export type PermissionCheck = (typeof PermissionChecks)[keyof typeof PermissionChecks];

export type LockedPolicy =
  | { type: "allow" }
  | { type: "deny" }
  | { type: "response"; response: Json }
  | { type: "queue" };

export type MethodDefinition<P = unknown> = {
  scope?: PermissionCapability;
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

export type { PermissionCapabilityResolver };

export const defineMethod = <P>(definition: MethodDefinition<P>): MethodDefinition<P> => definition;

export const defineNoParamsMethod = (
  definition: Omit<MethodDefinition<undefined>, "paramsSchema" | "parseParams"> & {
    paramsSchema?: never;
    parseParams?: never;
  },
): MethodDefinition<undefined> => ({ ...definition, paramsSchema: NoParamsSchema });
