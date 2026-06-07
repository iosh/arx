import { requestApproval } from "../../../../approvals/creation.js";
import type { ApprovalQueueKind, ApprovalRequest, ApprovalRequester } from "../../../../approvals/queue/types.js";
import type { ChainRef } from "../../../../chains/ids.js";
import type { ChainAddressCodecRegistry } from "../../../../chains/registry.js";
import { PermissionDeniedError, PermissionNotConnectedError } from "../../../../permissions/errors.js";
import type {
  PermissionViewsService,
  PermittedAccountView,
} from "../../../../services/runtime/permissionViews/types.js";
import type { Eip155TransactionRequest, TransactionIntent } from "../../../../transactions/index.js";
import { RpcInvalidRequestError } from "../../../errors.js";
import {
  ApprovalRequirements,
  AuthorizationRequirements,
  AuthorizedScopeChecks,
  defineMethod,
  defineNoParamsMethod,
  type MethodDefinition,
  type MethodHandler,
  type RpcExecutionContext,
  RpcExecutionContextKinds,
  type RpcProviderRequestContext,
} from "../../types.js";

export const requireRequestContext = (executionContext: RpcExecutionContext, method: string) => {
  if (executionContext.kind !== RpcExecutionContextKinds.Provider) {
    throw new RpcInvalidRequestError({
      message: `Missing request context for ${method}.`,
    });
  }
  return executionContext.requestContext;
};

export const requireProviderRequestHandle = (executionContext: RpcExecutionContext, method: string) => {
  if (executionContext.kind !== RpcExecutionContextKinds.Provider) {
    throw new RpcInvalidRequestError({
      message: `Missing provider request lifecycle for ${method}.`,
    });
  }
  return executionContext.providerRequestHandle;
};

export const buildDappApprovalRequester = (requestContext: RpcProviderRequestContext): ApprovalRequester => ({
  origin: requestContext.origin,
  initiator: "dapp",
  requestId: requestContext.requestId,
});

export const requestProviderApproval = <K extends ApprovalQueueKind>(args: {
  deps: {
    approvals: {
      create: Parameters<typeof requestApproval>[0]["approvals"]["create"];
    };
    clock: {
      now: () => number;
    };
  };
  executionContext: RpcExecutionContext;
  method: string;
  kind: K;
  request: ApprovalRequest<K>;
}) => {
  const requestContext = requireRequestContext(args.executionContext, args.method);
  const providerRequestHandle = requireProviderRequestHandle(args.executionContext, args.method);

  return providerRequestHandle.attachBlockingApproval(({ approvalId, createdAt }) =>
    requestApproval(
      {
        approvals: args.deps.approvals,
        now: args.deps.clock.now,
      },
      {
        kind: args.kind,
        requester: buildDappApprovalRequester(requestContext),
        request: args.request,
        approvalId,
        createdAt,
      },
    ),
  );
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
  deps: PermittedAccountDeps;
}) => {
  const { origin, chainRef, address, deps } = args;

  const canonical = deps.chainAddressCodecs.toCanonicalAddress({ chainRef, value: address }).canonical;
  const permittedAccounts = deps.permissionViews.listPermittedAccounts(origin, { chainRef });

  if (permittedAccounts.length === 0) {
    throw new PermissionNotConnectedError({
      message: `Origin "${origin}" is not connected`,
    });
  }

  const account = permittedAccounts.find((entry) => entry.canonicalAddress === canonical);
  if (!account) {
    throw new PermissionDeniedError({
      message: `Account is not permitted for origin "${origin}"`,
    });
  }

  return account;
};

export const buildEip155TransactionIntent = (args: {
  origin: string;
  method: string;
  chainRef: ChainRef;
  request: Eip155TransactionRequest;
  account: PermittedAccountView;
}) => {
  const requestedAddress = args.request.payload.from;

  return {
    namespace: "eip155" as const,
    chainRef: args.chainRef,
    account: {
      accountKey: args.account.accountKey,
      accountAddress: args.account.canonicalAddress,
      ...(requestedAddress ? { requestedAddress } : {}),
    },
    request: args.request,
  } satisfies TransactionIntent;
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
  "authorizationRequirement" | "approvalRequirement" | "authorizedScopeCheck" | "handler"
> & {
  authorizationRequirement?: never;
  approvalRequirement?: never;
  authorizedScopeCheck?: never;
  buildAuthorizedExecution: (
    context: MethodExecutionContext<P>,
  ) => AuthorizedEip155ExecutionPlan<Prepared> | Promise<AuthorizedEip155ExecutionPlan<Prepared>>;
  executeAuthorizedRequest: (
    context: MethodExecutionContext<P> & { account: PermittedAccountView; prepared: Prepared },
  ) => ReturnType<MethodHandler<P>>;
};

export const defineEip155AuthorizedAccountApprovalMethod = <P, Prepared>(
  definition: Eip155AuthorizedAccountApprovalMethodDefinition<P, Prepared>,
): MethodDefinition<P> => {
  const { buildAuthorizedExecution, executeAuthorizedRequest, ...methodDefinition } = definition;

  return defineMethod({
    ...methodDefinition,
    authorizationRequirement: AuthorizationRequirements.Required,
    approvalRequirement: ApprovalRequirements.Required,
    authorizedScopeCheck: AuthorizedScopeChecks.NamespaceSpecific,
    handler: async (context) => {
      const executionPlan = await buildAuthorizedExecution(context);
      const { address, prepared } = executionPlan;
      const chainRef = context.invocation.chainRef;

      const account = assertPermittedEip155Account({
        origin: context.origin,
        method: context.request.method,
        chainRef,
        address,
        deps: {
          permissionViews: context.services.permissionViews,
          chainAddressCodecs: context.deps.chainAddressCodecs,
        },
      });

      return executeAuthorizedRequest({
        ...context,
        account,
        prepared,
      });
    },
  });
};
