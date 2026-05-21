import { ArxReasons, arxError } from "@arx/errors";
import { requestApproval } from "../../../../approvals/creation.js";
import type { ChainRef } from "../../../../chains/ids.js";
import type { ChainAddressCodecRegistry } from "../../../../chains/registry.js";
import type { ApprovalKinds, ApprovalRequest } from "../../../../controllers/approval/types.js";
import type {
  PermissionViewsService,
  PermittedAccountView,
} from "../../../../services/runtime/permissionViews/types.js";
import type { Eip155TransactionRequest, TransactionIntent } from "../../../../transactions/index.js";
import {
  ApprovalRequirements,
  AuthorizationRequirements,
  AuthorizedScopeChecks,
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

export const requireProviderRequestHandle = (rpcContext: RpcInvocationContext | undefined, method: string) => {
  const providerRequestHandle = rpcContext?.providerRequestHandle;
  if (!providerRequestHandle) {
    throw arxError({
      reason: ArxReasons.RpcInvalidRequest,
      message: `Missing provider request lifecycle for ${method}.`,
      data: { method },
    });
  }
  return providerRequestHandle;
};

type ProviderApprovalKind = Exclude<
  (typeof ApprovalKinds)[keyof typeof ApprovalKinds],
  typeof ApprovalKinds.SendTransaction
>;

export const requestProviderApproval = <K extends ProviderApprovalKind>(args: {
  controllers: {
    approvals: {
      create: Parameters<typeof requestApproval>[0]["approvals"]["create"];
    };
    clock: {
      now: () => number;
    };
  };
  rpcContext: RpcInvocationContext | undefined;
  method: string;
  kind: K;
  request: ApprovalRequest<K>;
}) => {
  const requestContext = requireRequestContext(args.rpcContext, args.method);
  const providerRequestHandle = requireProviderRequestHandle(args.rpcContext, args.method);

  return providerRequestHandle.attachBlockingApproval(({ approvalId, createdAt }) =>
    requestApproval(
      {
        approvals: args.controllers.approvals,
        now: args.controllers.clock.now,
      },
      {
        kind: args.kind,
        requestContext,
        request: args.request,
        subject: undefined,
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
  controllers: PermittedAccountDeps;
}) => {
  const { origin, method, chainRef, address, controllers } = args;

  const canonical = controllers.chainAddressCodecs.toCanonicalAddress({ chainRef, value: address }).canonical;
  const permittedAccounts = controllers.permissionViews.listPermittedAccounts(origin, { chainRef });

  if (permittedAccounts.length === 0) {
    throw arxError({
      reason: ArxReasons.PermissionNotConnected,
      message: `Origin "${origin}" is not connected`,
      data: { origin, method, chainRef },
    });
  }

  const account = permittedAccounts.find((entry) => entry.canonicalAddress === canonical);
  if (!account) {
    throw arxError({
      reason: ArxReasons.PermissionDenied,
      message: `Account is not permitted for origin "${origin}"`,
      data: { origin, method, chainRef, from: canonical },
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
        controllers: {
          permissionViews: context.services.permissionViews,
          chainAddressCodecs: context.controllers.chainAddressCodecs,
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
