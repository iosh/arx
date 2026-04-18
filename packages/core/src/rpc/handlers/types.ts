import type { Json, JsonRpcParams } from "@metamask/utils";
import type { ZodType } from "zod";
import type { ChainRef } from "../../chains/ids.js";
import type { ChainAddressCodecRegistry } from "../../chains/registry.js";
import type { AccountController } from "../../controllers/account/types.js";
import type { ApprovalController } from "../../controllers/approval/types.js";
import type { NetworkController } from "../../controllers/network/types.js";
import type { PermissionsEvents, PermissionsReader, PermissionsWriter } from "../../controllers/permission/types.js";
import type { SupportedChainsController } from "../../controllers/supportedChains/types.js";
import type { TransactionController } from "../../controllers/transaction/types.js";
import type { NamespaceSignerRegistry } from "../../namespaces/types.js";
import type { ProviderRequestHandle } from "../../runtime/provider/providerRequests.js";
import type { PermissionViewsService } from "../../services/runtime/permissionViews/types.js";
import type { NetworkSelectionService } from "../../services/store/networkSelection/types.js";
import type { RequestContext } from "../requestContext.js";
import type { RpcRequestKind } from "../requestKind.js";
import { NoParamsSchema } from "./params.js";

export type HandlerControllers = {
  network: NetworkController;
  networkSelection?: NetworkSelectionService;
  accounts: AccountController;
  approvals: ApprovalController;
  permissions: PermissionsReader & PermissionsWriter & PermissionsEvents;
  transactions: TransactionController;
  supportedChains?: SupportedChainsController;
  chainAddressCodecs: ChainAddressCodecRegistry;
  clock: {
    now: () => number;
  };
  signers: NamespaceSignerRegistry;
};

export type HandlerRuntimeServices = {
  permissionViews: Pick<PermissionViewsService, "getAuthorizationSnapshot" | "listPermittedAccounts">;
};

export type RpcRequest = {
  method: string;
  params?: JsonRpcParams;
};

export type RpcInvocationContext = {
  chainRef?: ChainRef | null;
  namespace?: Namespace | null;
  providerNamespace?: Namespace | null;
  requestContext?: RequestContext | null;
  providerRequestHandle?: ProviderRequestHandle | null;
  meta?: unknown;
};

type MethodHandlerContext<P> = {
  origin: string;
  request: RpcRequest;
  params: P;
  controllers: HandlerControllers;
  services: HandlerRuntimeServices;
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

export const AuthorizationRequirements = {
  None: "none",
  Required: "required",
} as const;
export type AuthorizationRequirement = (typeof AuthorizationRequirements)[keyof typeof AuthorizationRequirements];

export const deriveAuthorizationRequirement = (definition: {
  authorizationRequirement: AuthorizationRequirement;
}): AuthorizationRequirement => {
  return definition.authorizationRequirement;
};

export type LockedPolicy =
  | { type: "allow" }
  | { type: "deny" }
  | { type: "response"; response: Json }
  | { type: "queue" };

export const ApprovalRequirements = {
  None: "none",
  Required: "required",
} as const;
export type ApprovalRequirement = (typeof ApprovalRequirements)[keyof typeof ApprovalRequirements];

export const deriveApprovalRequirement = (definition: {
  approvalRequirement: ApprovalRequirement;
}): ApprovalRequirement => {
  return definition.approvalRequirement;
};

export const AuthorizedScopeChecks = {
  None: "none",
  NamespaceSpecific: "namespace_specific",
} as const;
export type AuthorizedScopeCheck = (typeof AuthorizedScopeChecks)[keyof typeof AuthorizedScopeChecks];

export const deriveAuthorizedScopeCheck = (definition: {
  authorizedScopeCheck: AuthorizedScopeCheck;
}): AuthorizedScopeCheck => {
  return definition.authorizedScopeCheck;
};

export type MethodDefinition<P = unknown> = {
  /**
   * Request kind label used by RPC and approval presentation surfaces.
   */
  requestKind?: RpcRequestKind;
  /**
   * Authorization precondition enforced by the generic access-policy middleware.
   *
   * - "none": the request does not require prior connection authorization.
   * - "required": the request requires origin+namespace+chainRef to be authorized.
   */
  authorizationRequirement: AuthorizationRequirement;
  /**
   * Request-level approval fact declared by the method definition.
   *
   * Middleware does not execute this requirement. Namespace handlers and the
   * transactions pipeline still own approval creation and execution.
   *
   * - "none": the request may execute without creating an approval.
   * - "required": the request must route through an approval or confirmation flow.
   */
  approvalRequirement: ApprovalRequirement;
  /**
   * Namespace-specific authorization-scope validation required before the
   * sensitive action executes.
   *
   * Generic middleware does not perform this check. Namespace handlers or
   * namespace helpers must validate account, chain, and request scope.
   *
   * - "none": no extra namespace-specific scope validation is required.
   * - "namespace_specific": handler must validate request scope against the
   *   authorized connection scope.
   */
  authorizedScopeCheck: AuthorizedScopeCheck;
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

export const defineMethod = <P>(definition: MethodDefinition<P>): MethodDefinition<P> => definition;

export const defineNoParamsMethod = (
  definition: Omit<MethodDefinition<undefined>, "paramsSchema" | "parseParams"> & {
    paramsSchema?: never;
    parseParams?: never;
  },
): MethodDefinition<undefined> => ({ ...definition, paramsSchema: NoParamsSchema });
