import { ArxReasons, arxError } from "@arx/errors";
import type { ChainRef } from "../../../../chains/ids.js";
import type { ChainAddressCodecRegistry } from "../../../../chains/registry.js";
import type { TransactionController, TransactionMeta } from "../../../../controllers/index.js";
import type { PermissionViewsService } from "../../../../services/runtime/permissionViews/types.js";
import {
  ApprovalRequirements,
  AuthorizedScopeChecks,
  ConnectionRequirements,
  defineMethod,
  defineNoParamsMethod,
  type MethodDefinition,
  type MethodHandler,
  type RpcInvocationContext,
} from "../../types.js";

export const requireRequestContext = (rpcContext: RpcInvocationContext | undefined, method: string) => {
  const requestContext = rpcContext?.requestContext;
  if (!requestContext) {
    throw arxError({
      reason: ArxReasons.RpcInvalidRequest,
      message: `Missing request context for ${method}.`,
      data: { method },
    });
  }
  return requestContext;
};

type PermittedAccountDeps = {
  permissionViews: Pick<PermissionViewsService, "listPermittedAccounts">;
  chainAddressCodecs: Pick<ChainAddressCodecRegistry, "toCanonicalAddress">;
};

export const assertPermittedEip155Account = (args: {
  origin: string;
  method: string;
  chainRef: ChainRef;
  address: string;
  controllers: PermittedAccountDeps;
}): string => {
  const { origin, method, chainRef, address, controllers } = args;

  const canonical = controllers.chainAddressCodecs.toCanonicalAddress({ chainRef, value: address }).canonical;
  const permitted = controllers.permissionViews
    .listPermittedAccounts(origin, { chainRef })
    .map((account) => account.canonicalAddress);

  if (permitted.length === 0) {
    throw arxError({
      reason: ArxReasons.PermissionNotConnected,
      message: `Origin "${origin}" is not connected`,
      data: { origin, method, chainRef },
    });
  }

  if (!permitted.includes(canonical)) {
    throw arxError({
      reason: ArxReasons.PermissionDenied,
      message: `Account is not permitted for origin "${origin}"`,
      data: { origin, method, chainRef, from: canonical },
    });
  }

  return canonical;
};

type MethodExecutionContext<P> = Parameters<MethodHandler<P>>[0];

type Eip155ApprovalMethodDefinition<P> = Omit<MethodDefinition<P>, "approvalRequirement"> & {
  approvalRequirement?: never;
};

export const defineEip155ApprovalMethod = <P>(definition: Eip155ApprovalMethodDefinition<P>): MethodDefinition<P> => {
  return defineMethod({
    ...definition,
    approvalRequirement: ApprovalRequirements.Required,
  });
};

type Eip155NoParamsApprovalMethodDefinition = Omit<
  MethodDefinition<undefined>,
  "approvalRequirement" | "paramsSchema" | "parseParams"
> & {
  approvalRequirement?: never;
  paramsSchema?: never;
  parseParams?: never;
};

export const defineEip155NoParamsApprovalMethod = (
  definition: Eip155NoParamsApprovalMethodDefinition,
): MethodDefinition<undefined> => {
  return defineNoParamsMethod({
    ...definition,
    approvalRequirement: ApprovalRequirements.Required,
  });
};

type AuthorizedEip155ExecutionPlan<Prepared> = {
  address: string;
  prepared: Prepared;
};

type Eip155AuthorizedAccountApprovalMethodDefinition<P, Prepared> = Omit<
  MethodDefinition<P>,
  "connectionRequirement" | "approvalRequirement" | "authorizedScopeCheck" | "handler"
> & {
  connectionRequirement?: never;
  approvalRequirement?: never;
  authorizedScopeCheck?: never;
  buildAuthorizedExecution: (
    context: MethodExecutionContext<P>,
  ) => AuthorizedEip155ExecutionPlan<Prepared> | Promise<AuthorizedEip155ExecutionPlan<Prepared>>;
  executeAuthorizedRequest: (
    context: MethodExecutionContext<P> & { from: string; prepared: Prepared },
  ) => ReturnType<MethodHandler<P>>;
};

export const defineEip155AuthorizedAccountApprovalMethod = <P, Prepared>(
  definition: Eip155AuthorizedAccountApprovalMethodDefinition<P, Prepared>,
): MethodDefinition<P> => {
  const { buildAuthorizedExecution, executeAuthorizedRequest, ...methodDefinition } = definition;

  return defineMethod({
    ...methodDefinition,
    connectionRequirement: ConnectionRequirements.Required,
    approvalRequirement: ApprovalRequirements.Required,
    authorizedScopeCheck: AuthorizedScopeChecks.NamespaceSpecific,
    handler: async (context) => {
      const executionPlan = await buildAuthorizedExecution(context);
      const { address, prepared } = executionPlan;
      const chainRef = context.invocation.chainRef;

      const from = assertPermittedEip155Account({
        origin: context.origin,
        method: context.request.method,
        chainRef,
        address,
        controllers: {
          permissionViews: context.services.permissionViews,
          chainAddressCodecs: context.controllers.chainAddressCodecs,
        },
      });

      return executeAuthorizedRequest({
        ...context,
        from,
        prepared,
      });
    },
  });
};

export class TransactionResolutionError extends Error {
  readonly meta: TransactionMeta;

  constructor(meta: TransactionMeta) {
    super(meta.error?.message ?? "Transaction failed");
    this.name = "TransactionResolutionError";
    this.meta = meta;
  }
}

const RESOLVED_STATUSES = new Set<TransactionMeta["status"]>(["broadcast", "confirmed"]);
const FAILED_STATUSES = new Set<TransactionMeta["status"]>(["failed", "replaced"]);

const isResolved = (meta: TransactionMeta) => RESOLVED_STATUSES.has(meta.status) && typeof meta.hash === "string";
const isFailed = (meta: TransactionMeta) => FAILED_STATUSES.has(meta.status);

export const waitForTransactionBroadcast = async (
  controller: Pick<TransactionController, "getMeta" | "onStatusChanged">,
  id: string,
): Promise<TransactionMeta> => {
  const initial = controller.getMeta(id);
  if (!initial) {
    throw new Error(`Transaction ${id} not found after submission`);
  }
  if (isResolved(initial)) {
    return initial;
  }
  if (isFailed(initial)) {
    throw new TransactionResolutionError(initial);
  }

  return new Promise<TransactionMeta>((resolve, reject) => {
    const unsubscribe = controller.onStatusChanged(({ id: changeId, meta }) => {
      if (changeId !== id) {
        return;
      }

      if (isResolved(meta)) {
        unsubscribe();
        resolve(meta);
        return;
      }

      if (isFailed(meta)) {
        unsubscribe();
        reject(new TransactionResolutionError(meta));
      }
    });
  });
};

export const isTransactionResolutionError = (error: unknown): error is TransactionResolutionError =>
  error instanceof TransactionResolutionError;
