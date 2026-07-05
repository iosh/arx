import { ZodError, z } from "zod";
import { ApprovalKinds } from "../../../../approvals/index.js";
import type { ChainRef } from "../../../../chains/ids.js";
import { isArxBaseError } from "../../../../error.js";
import { isConnectionGrantKind } from "../../../../permissions/connectionGrantKinds.js";
import { buildEip2255Permissions } from "../../../../permissions/eip2255.js";
import {
  type ConnectionGrantKind,
  ConnectionGrantKinds,
  type ConnectionGrantRequest,
} from "../../../../permissions/index.js";
import { RpcInternalError, RpcInvalidParamsError } from "../../../errors.js";
import { RpcRequestKinds } from "../../../requestKind.js";
import { lockedQueue } from "../../locked.js";
import { AuthorizationRequirements, AuthorizedScopeChecks } from "../../types.js";
import { isDomainError, isRpcError, toParamsArray } from "../utils.js";
import { grantAccountsForConnectionApproval } from "./connectionPermissions.js";
import { defineEip155ApprovalMethod, requestProviderApproval } from "./shared.js";

const toConnectionGrantRequests = (
  grantKinds: readonly ConnectionGrantKind[],
  defaultChain: ChainRef,
): ConnectionGrantRequest[] => {
  const requests = new Map<string, ConnectionGrantRequest>();

  const addGrantKind = (grantKind: string) => {
    if (!isConnectionGrantKind(grantKind)) return;
    const existing = requests.get(grantKind);
    if (existing) return;

    requests.set(grantKind, { grantKind, chainRefs: [defaultChain] });
  };

  for (const grantKind of grantKinds) {
    addGrantKind(grantKind);
  }

  return [...requests.values()];
};

const readAccountGrantChainRefs = (grants: readonly ConnectionGrantRequest[]): [ChainRef, ...ChainRef[]] => {
  const chainRefs: ChainRef[] = [];

  for (const grant of grants) {
    if (grant.grantKind !== ConnectionGrantKinds.Accounts) {
      throw new RpcInvalidParamsError({
        message: `Unsupported connection grant kind "${grant.grantKind}"`,
      });
    }

    chainRefs.push(...grant.chainRefs);
  }

  if (chainRefs.length === 0) {
    throw new RpcInvalidParamsError({
      message: "wallet_requestPermissions requires at least one account grant chain.",
    });
  }

  return chainRefs as [ChainRef, ...ChainRef[]];
};

type WalletRequestPermissionsParams = readonly ConnectionGrantKind[];

const WalletRequestPermissionsParamsSchema = z
  .any()
  .transform((params): unknown => toParamsArray(params)[0])
  .pipe(z.looseObject({}))
  .transform((value): WalletRequestPermissionsParams => {
    const entries = Object.keys(value);
    if (entries.length === 0) {
      throw new RpcInvalidParamsError({
        message: "wallet_requestPermissions requires at least one capability",
      });
    }

    const out: ConnectionGrantKind[] = [];
    for (const capability of new Set<string>(entries)) {
      if (!isConnectionGrantKind(capability)) {
        throw new RpcInvalidParamsError({
          message: `wallet_requestPermissions does not support capability "${capability}"`,
        });
      }
      if (capability !== ConnectionGrantKinds.Accounts) {
        throw new RpcInvalidParamsError({
          message: `wallet_requestPermissions only supports "${ConnectionGrantKinds.Accounts}"`,
        });
      }
      out.push(capability);
    }

    return out;
  });

export const walletRequestPermissionsDefinition = defineEip155ApprovalMethod({
  requestKind: RpcRequestKinds.AccountAccess,
  authorizationRequirement: AuthorizationRequirements.None,
  authorizedScopeCheck: AuthorizedScopeChecks.None,
  locked: lockedQueue(),
  parseParams: (params) => {
    try {
      return WalletRequestPermissionsParamsSchema.parse(params);
    } catch (error) {
      if (error instanceof ZodError) {
        throw new RpcInvalidParamsError({
          message: "wallet_requestPermissions expects a single object parameter",
          cause: error,
        });
      }
      throw error;
    }
  },
  handler: async (context) => {
    const { params, deps, executionContext, invocation } = context;
    const chainRef = invocation.chainRef;

    const requestedGrants = toConnectionGrantRequests(params, chainRef);
    try {
      const approval = await requestProviderApproval({
        deps,
        executionContext,
        method: "wallet_requestPermissions",
        kind: ApprovalKinds.RequestPermissions,
        chainRef,
        request: { chainRef, requestedGrants },
      });
      const decision = await approval.settled;
      const approvalRecord = {
        approvalId: approval.approvalId,
        kind: ApprovalKinds.RequestPermissions,
        origin: context.origin,
        namespace: invocation.namespace,
        chainRef,
        request: { chainRef, requestedGrants },
      };

      const grantedGrants = requestedGrants.map((descriptor) => ({
        grantKind: descriptor.grantKind,
        chainRefs: [...descriptor.chainRefs] as ConnectionGrantRequest["chainRefs"],
      }));
      const authorizedChainRefs = readAccountGrantChainRefs(grantedGrants);
      await grantAccountsForConnectionApproval({
        approval: approvalRecord,
        decision,
        selectionChainRef: authorizedChainRefs[0],
        authorizedChainRefs,
        deps,
      });
    } catch (error) {
      if (isDomainError(error) || isRpcError(error) || isArxBaseError(error)) throw error;
      throw new RpcInternalError({
        message: "Failed to request permissions approval",
        cause: error,
      });
    }

    const snapshot = deps.permissionViews.getAuthorizationSnapshot(context.origin, { chainRef });

    return buildEip2255Permissions({
      origin: context.origin,
      accountAddresses: snapshot.accounts.map((account) => account.canonicalAddress),
    });
  },
});
