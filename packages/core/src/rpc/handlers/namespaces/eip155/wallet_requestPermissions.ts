import { ArxReasons, arxError, isArxError } from "@arx/errors";
import { ZodError, z } from "zod";
import type { ChainRef } from "../../../../chains/ids.js";
import {
  ApprovalKinds,
  type ConnectionGrantKind,
  ConnectionGrantKinds,
  type ConnectionGrantRequest,
} from "../../../../controllers/index.js";
import { isConnectionGrantKind } from "../../../../permissions/connectionGrantKinds.js";
import { buildEip2255PermissionsFromAuthorizationSnapshot } from "../../../permissions.js";
import { RpcRequestKinds } from "../../../requestKind.js";
import { lockedQueue } from "../../locked.js";
import { AuthorizationRequirements, AuthorizedScopeChecks } from "../../types.js";
import { isDomainError, isRpcError, toParamsArray } from "../utils.js";
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

type WalletRequestPermissionsParams = readonly ConnectionGrantKind[];

const WalletRequestPermissionsParamsSchema = z
  .any()
  .transform((params): unknown => toParamsArray(params)[0])
  .pipe(z.looseObject({}))
  .transform((value): WalletRequestPermissionsParams => {
    const entries = Object.keys(value);
    if (entries.length === 0) {
      throw arxError({
        reason: ArxReasons.RpcInvalidParams,
        message: "wallet_requestPermissions requires at least one capability",
      });
    }

    const out: ConnectionGrantKind[] = [];
    for (const capability of new Set<string>(entries)) {
      if (!isConnectionGrantKind(capability)) {
        throw arxError({
          reason: ArxReasons.RpcInvalidParams,
          message: `wallet_requestPermissions does not support capability "${capability}"`,
          data: { capability },
        });
      }
      if (capability !== ConnectionGrantKinds.Accounts) {
        throw arxError({
          reason: ArxReasons.RpcInvalidParams,
          message: `wallet_requestPermissions only supports "${ConnectionGrantKinds.Accounts}"`,
          data: { capability },
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
  parseParams: (params, _rpcContext) => {
    try {
      return WalletRequestPermissionsParamsSchema.parse(params);
    } catch (error) {
      if (error instanceof ZodError) {
        throw arxError({
          reason: ArxReasons.RpcInvalidParams,
          message: "wallet_requestPermissions expects a single object parameter",
          data: { params },
          cause: error,
        });
      }
      throw error;
    }
  },
  handler: async ({ origin, params, controllers, services, rpcContext, invocation }) => {
    const chainRef = invocation.chainRef;

    const requestedGrants = toConnectionGrantRequests(params, chainRef);
    try {
      await requestProviderApproval({
        controllers,
        rpcContext,
        method: "wallet_requestPermissions",
        kind: ApprovalKinds.RequestPermissions,
        request: { chainRef, requestedGrants },
      }).settled;
    } catch (error) {
      if (isDomainError(error) || isRpcError(error) || isArxError(error)) throw error;
      throw arxError({
        reason: ArxReasons.RpcInternal,
        message: "Failed to request permissions approval",
        data: { origin },
        cause: error,
      });
    }

    return buildEip2255PermissionsFromAuthorizationSnapshot({
      origin,
      snapshot: services.permissionViews.getAuthorizationSnapshot(origin, { chainRef }),
    });
  },
});
