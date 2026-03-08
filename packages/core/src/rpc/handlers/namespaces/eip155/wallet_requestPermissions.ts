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
import { buildWalletPermissions } from "../../../permissions.js";
import { lockedQueue } from "../../locked.js";
import { type MethodDefinition, PermissionChecks } from "../../types.js";
import { createApprovalId, EIP155_NAMESPACE, isDomainError, isRpcError, toParamsArray } from "../utils.js";
import { requireApprovalRequester } from "./shared.js";

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

    const unique = new Set<string>(entries);
    unique.add(PermissionCapabilities.Basic);

    const out: PermissionCapability[] = [];
    for (const capability of unique) {
      if (!isPermissionCapability(capability)) {
        throw arxError({
          reason: ArxReasons.RpcInvalidParams,
          message: `wallet_requestPermissions does not support capability "${capability}"`,
          data: { capability },
        });
      }
      out.push(capability);
    }

    return out;
  });

export const walletRequestPermissionsDefinition: MethodDefinition<WalletRequestPermissionsParams> = {
  capability: PermissionCapabilities.Basic,
  permissionCheck: PermissionChecks.None,
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
  handler: async ({ origin, params, controllers, rpcContext, invocation }) => {
    const chainRef = invocation.chainRef;
    const namespace = EIP155_NAMESPACE;

    const requested = toRequestDescriptors(params, chainRef);
    const request = {
      id: createApprovalId("wallet_requestPermissions"),
      kind: ApprovalKinds.RequestPermissions,
      origin,
      namespace,
      chainRef,
      createdAt: controllers.clock.now(),
      request: { requested },
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

    const permissionGrants = controllers.permissions.listGrants(origin);
    const getAccounts = (targetChainRef: string) =>
      controllers.permissions.getPermittedAccounts(origin, {
        namespace,
        chainRef: targetChainRef as ChainRef,
      });

    return buildWalletPermissions({ origin, grants: permissionGrants, getAccounts });
  },
};
