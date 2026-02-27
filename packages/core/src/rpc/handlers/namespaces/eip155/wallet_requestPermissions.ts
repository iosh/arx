import { ArxReasons, arxError, isArxError } from "@arx/errors";
import { ZodError, z } from "zod";
import type { ChainRef } from "../../../../chains/ids.js";
import {
  type ApprovalTask,
  ApprovalTypes,
  PermissionCapabilities,
  type PermissionCapability,
  type PermissionRequestDescriptor,
} from "../../../../controllers/index.js";
import { isPermissionCapability } from "../../../../permissions/capabilities.js";
import { buildWalletPermissions } from "../../../permissions.js";
import { lockedQueue } from "../../locked.js";
import { type MethodDefinition, PermissionChecks } from "../../types.js";
import { createTaskId, EIP155_NAMESPACE, isDomainError, isRpcError, toParamsArray } from "../utils.js";
import { requireRequestContext } from "./shared.js";

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
    const task = {
      id: createTaskId("wallet_requestPermissions"),
      type: ApprovalTypes.RequestPermissions,
      origin,
      namespace,
      chainRef,
      createdAt: controllers.clock.now(),
      payload: { requested },
    } satisfies ApprovalTask<typeof ApprovalTypes.RequestPermissions>;

    let result: { granted: PermissionRequestDescriptor[] } | null = null;
    try {
      result = await controllers.approvals.requestApproval(
        task,
        requireRequestContext(rpcContext, "wallet_requestPermissions"),
      );
    } catch (error) {
      if (isDomainError(error) || isRpcError(error) || isArxError(error)) throw error;
      throw arxError({
        reason: ArxReasons.RpcInternal,
        message: "Failed to request permissions approval",
        data: { origin },
        cause: error,
      });
    }

    const grantedDescriptors = result?.granted ?? [];
    try {
      for (const descriptor of grantedDescriptors) {
        const targetChains = descriptor.chainRefs.length ? descriptor.chainRefs : [chainRef];
        for (const targetChainRef of targetChains) {
          if (descriptor.capability === PermissionCapabilities.Accounts) {
            const all = controllers.accounts.getAccounts({ chainRef: targetChainRef });
            const preferredAddress = controllers.accounts.getSelectedAddress({ chainRef: targetChainRef });
            const preferred = preferredAddress && all.includes(preferredAddress) ? preferredAddress : null;
            const selected = preferred ?? all[0] ?? null;
            if (!selected) {
              throw arxError({
                reason: ArxReasons.PermissionDenied,
                message: "No selectable account available for permission request",
                data: { origin, chainRef: targetChainRef, capability: descriptor.capability },
              });
            }

            await controllers.permissions.setPermittedAccounts(origin, {
              namespace,
              chainRef: targetChainRef,
              accounts: [selected],
            });
            continue;
          }

          await controllers.permissions.grant(origin, descriptor.capability, {
            namespace,
            chainRef: targetChainRef,
          });
        }
      }
    } catch (error) {
      if (isDomainError(error) || isRpcError(error) || isArxError(error)) throw error;
      throw arxError({
        reason: ArxReasons.RpcInternal,
        message: "Failed to persist granted permissions",
        data: { origin },
        cause: error,
      });
    }

    const permissionGrants = controllers.permissions.listGrants(origin);
    const getAccounts = (chainRef: string) =>
      controllers.permissions.getPermittedAccounts(origin, {
        namespace,
        chainRef: chainRef as ChainRef,
      });
    return buildWalletPermissions({ origin, grants: permissionGrants, getAccounts });
  },
};
