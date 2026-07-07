import type { Json, JsonRpcParams } from "@metamask/utils";
import type { ZodType } from "zod";
import type { AccountSelectionService } from "../../accounts/runtime/types.js";
import type { ApprovalQueueService } from "../../approvals/queue/types.js";
import type { ChainAddressingByNamespace } from "../../chains/addressing.js";
import type { ChainRef } from "../../chains/ids.js";
import type { ChainRpcReader } from "../../chains/rpc/types.js";
import type { ChainDefinitionsService } from "../../chains/runtime/chainDefinitions/types.js";
import type { NamespaceRuntimeServices } from "../../namespaces/index.js";
import type { PermissionsEvents, PermissionsReader, PermissionsWriter } from "../../permissions/service/types.js";
import type { ChainActivationService } from "../../chains/activation/types.js";
import type { PermissionViewsService } from "../../permissions/views/types.js";
import type { ChainRpcDefaultEndpointsService } from "../../chains/rpc/defaultEndpoints/types.js";
import type { WalletChainSelectionService } from "../../chains/selection/wallet/types.js";
import type { TransactionsService } from "../../transactions/TransactionsService.js";
import type { RpcExecutionContext } from "../executionContext.js";
import type { RpcRequestKind } from "../requestKind.js";
import { NoParamsSchema } from "./params.js";

export type {
  RpcExecutionContext,
  RpcProviderExecutionContext,
  RpcProviderRequestCancellationReason,
  RpcProviderRequestContext,
  RpcProviderRequestHandle,
} from "../executionContext.js";
export {
  NO_RPC_EXECUTION_CONTEXT,
  RpcExecutionContextKinds,
} from "../executionContext.js";

export type RpcHandlerDeps = {
  createId: () => string;
  now: () => number;
  chainRpc: ChainRpcReader;
  walletChainSelection: WalletChainSelectionService;
  accounts: AccountSelectionService;
  approvals: ApprovalQueueService;
  permissions: PermissionsReader & PermissionsWriter & PermissionsEvents;
  chainActivation: ChainActivationService;
  chainDefinitions: ChainDefinitionsService;
  chainRpcDefaultEndpoints?: Pick<ChainRpcDefaultEndpointsService, "readDefaultEndpoints" | "setDefaultEndpoints">;
  chainAddressing: ChainAddressingByNamespace;
  permissionViews: Pick<PermissionViewsService, "getAuthorizationSnapshot" | "listPermittedAccounts">;
  namespaceRuntime: NamespaceRuntimeServices;
  transactions: Pick<TransactionsService, "prepareTransaction" | "submitTransaction">;
};

export type RpcRequest = {
  method: string;
  params?: JsonRpcParams;
};

export type RpcInvocationHint = {
  namespace?: Namespace;
  chainRef?: ChainRef;
};

type MethodHandlerContext<P> = {
  origin: string;
  request: RpcRequest;
  params: P;
  deps: RpcHandlerDeps;
  invocation: { namespace: Namespace; chainRef: ChainRef };
  executionContext: RpcExecutionContext;
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

export const AuthorizedScopeChecks = {
  None: "none",
  NamespaceSpecific: "namespace_specific",
} as const;
export type AuthorizedScopeCheck = (typeof AuthorizedScopeChecks)[keyof typeof AuthorizedScopeChecks];

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
   * Optional custom parser for params when validation depends on the resolved invocation target.
   * Prefer `paramsSchema` when possible.
   */
  parseParams?: (params: JsonRpcParams | undefined, invocation: { namespace: Namespace; chainRef: ChainRef }) => P;
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
