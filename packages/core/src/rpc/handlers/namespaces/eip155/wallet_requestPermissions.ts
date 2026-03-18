import { ArxReasons, arxError, isArxError } from "@arx/errors";
import { ZodError, z } from "zod";
import type { ChainRef } from "../../../../chains/ids.js";
import {
  type ApprovalCreateParams,
  ApprovalKinds,
  PermissionCapabilities,
  type PermissionCapability,
  type PermissionRequestDescriptor,
} from "../../../../controllers/index.js";
import { isPermissionCapability } from "../../../../permissions/capabilities.js";
import { RpcRequestClassifications } from "../../../requestClassification.js";
import { lockedQueue } from "../../locked.js";
import { AuthorizedScopeChecks, ConnectionRequirements } from "../../types.js";
import { createApprovalId, isDomainError, isRpcError, toParamsArray } from "../utils.js";
import { defineEip155ApprovalMethod, requireApprovalRequester } from "./shared.js";

const toRequestDescriptors = (
  capabilities: readonly PermissionCapability[],
  defaultChain: ChainRef,
): PermissionRequestDescriptor[] => {
  const requests = new Map<string, PermissionRequestDescriptor>();

  const addCapability = (capability: string) => {
    if (!isPermissionCapability(capability)) return;
    const existing = requests.get(capability);
    if (existing) return;

    requests.set(capability, { capability, chainRefs: [defaultChain] });
  };

  for (const capability of capabilities) {
    addCapability(capability);
  }

  return [...requests.values()];
};

type WalletRequestPermissionsParams = readonly PermissionCapability[];

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

    const out: PermissionCapability[] = [];
    for (const capability of new Set<string>(entries)) {
      if (!isPermissionCapability(capability)) {
        throw arxError({
          reason: ArxReasons.RpcInvalidParams,
          message: `wallet_requestPermissions does not support capability "${capability}"`,
          data: { capability },
        });
      }
      if (capability !== PermissionCapabilities.Accounts) {
        throw arxError({
          reason: ArxReasons.RpcInvalidParams,
          message: `wallet_requestPermissions only supports "${PermissionCapabilities.Accounts}"`,
          data: { capability },
        });
      }
      out.push(capability);
    }

    return out;
  });

export const walletRequestPermissionsDefinition = defineEip155ApprovalMethod({
  requestClassification: RpcRequestClassifications.AccountsAccess,
  connectionRequirement: ConnectionRequirements.None,
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
    const namespace = invocation.namespace;

    const requested = toRequestDescriptors(params, chainRef);
    const request = {
      id: createApprovalId("wallet_requestPermissions"),
      kind: ApprovalKinds.RequestPermissions,
      origin,
      namespace,
      chainRef,
      createdAt: controllers.clock.now(),
      request: { chainRef, requested },
    } satisfies ApprovalCreateParams<typeof ApprovalKinds.RequestPermissions>;

    try {
      await controllers.approvals.create(request, requireApprovalRequester(rpcContext, "wallet_requestPermissions"))
        .settled;
    } catch (error) {
      if (isDomainError(error) || isRpcError(error) || isArxError(error)) throw error;
      throw arxError({
        reason: ArxReasons.RpcInternal,
        message: "Failed to request permissions approval",
        data: { origin },
        cause: error,
      });
    }

    return services.permissionViews.buildWalletPermissions(origin, { namespace, chainRef });
  },
});
