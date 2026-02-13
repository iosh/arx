import { ArxReasons, arxError } from "@arx/errors";
import type { ChainRef } from "../../../../chains/ids.js";
import {
  type ApprovalTask,
  ApprovalTypes,
  type PermissionApprovalResult,
  type PermissionRequestDescriptor,
  type PermissionScope,
  PermissionScopes,
  type RequestPermissionsApprovalPayload,
} from "../../../../controllers/index.js";
import { buildWalletPermissions, PERMISSION_SCOPE_CAPABILITIES } from "../../../permissions.js";
import { type MethodDefinition, PermissionChecks } from "../../types.js";
import { createTaskId, isDomainError, isRpcError, toParamsArray } from "../utils.js";
import { requireRequestContext } from "./shared.js";

const CAPABILITY_TO_SCOPE = new Map(
  Object.entries(PERMISSION_SCOPE_CAPABILITIES).map(([scope, capability]) => [capability, scope as PermissionScope]),
);

const toRequestDescriptors = (capabilities: readonly string[], defaultChain: ChainRef): PermissionRequestDescriptor[] => {
  const requests = new Map<string, PermissionRequestDescriptor>();

  const addCapability = (capability: string) => {
    const scope = CAPABILITY_TO_SCOPE.get(capability);
    if (!scope) {
      throw arxError({
        reason: ArxReasons.RpcInvalidParams,
        message: `wallet_requestPermissions does not support capability "${capability}"`,
        data: { capability },
      });
    }
    const existing = requests.get(capability);
    if (existing) return;

    requests.set(capability, { scope, capability, chains: [defaultChain] });
  };

  for (const capability of capabilities) {
    addCapability(capability);
  }

  return [...requests.values()];
};

type WalletRequestPermissionsParams = readonly string[];

export const walletRequestPermissionsDefinition: MethodDefinition<WalletRequestPermissionsParams> = {
  scope: PermissionScopes.Basic,
  permissionCheck: PermissionChecks.None,
  approvalRequired: true,
  parseParams: (params, rpcContext) => {
    const [raw] = toParamsArray(params);
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
      throw arxError({
        reason: ArxReasons.RpcInvalidParams,
        message: "wallet_requestPermissions expects a single object parameter",
        data: { params },
      });
    }

    const entries = Object.keys(raw);
    if (entries.length === 0) {
      throw arxError({
        reason: ArxReasons.RpcInvalidParams,
        message: "wallet_requestPermissions requires at least one capability",
        data: { params },
      });
    }

    // If caller provides rpcContext.chainRef, ensure it looks like a CAIP-2-ish id.
    if (rpcContext?.chainRef && typeof rpcContext.chainRef === "string" && !rpcContext.chainRef.includes(":")) {
      throw arxError({
        reason: ArxReasons.RpcInvalidRequest,
        message: "wallet_requestPermissions received an invalid chainRef identifier",
        data: { chainRef: rpcContext.chainRef },
      });
    }

    const capabilities = new Set<string>(entries);
    capabilities.add(PERMISSION_SCOPE_CAPABILITIES[PermissionScopes.Basic]);

    return [...capabilities];
  },
  handler: async ({ origin, params, controllers, rpcContext }) => {
    const activeChain = controllers.network.getActiveChain();

    const requested = toRequestDescriptors(params, activeChain.chainRef);
    const task: ApprovalTask<RequestPermissionsApprovalPayload> = {
      id: createTaskId("wallet_requestPermissions"),
      type: ApprovalTypes.RequestPermissions,
      origin,
      namespace: activeChain.namespace,
      chainRef: activeChain.chainRef,
      createdAt: Date.now(),
      payload: { requested },
    };

    try {
      const result = (await controllers.approvals.requestApproval(
        task,
        requireRequestContext(rpcContext, "wallet_requestPermissions"),
      )) as PermissionApprovalResult;
      const grants = result?.granted ?? [];

      for (const descriptor of grants) {
        const targetChains = descriptor.chains.length ? descriptor.chains : [activeChain.chainRef];
        for (const chainRef of targetChains) {
          if (descriptor.scope === PermissionScopes.Accounts) {
            const all = controllers.accounts.getAccounts({ chainRef });
            const pointer = controllers.accounts.getActivePointer();
            const preferred =
              pointer?.chainRef === chainRef && pointer.address && all.includes(pointer.address)
                ? pointer.address
                : null;
            const selected = preferred ?? all[0] ?? null;
            if (!selected) {
              throw arxError({
                reason: ArxReasons.PermissionDenied,
                message: "No selectable account available for permission request",
                data: { origin, chainRef, capability: descriptor.capability },
              });
            }

            await controllers.permissions.setPermittedAccounts(origin, {
              namespace: activeChain.namespace,
              chainRef,
              accounts: [selected],
            });
            continue;
          }

          await controllers.permissions.grant(origin, descriptor.scope, {
            namespace: activeChain.namespace,
            chainRef,
          });
        }
      }
    } catch (error) {
      if (isDomainError(error) || isRpcError(error)) throw error;
      throw arxError({
        reason: ArxReasons.ApprovalRejected,
        message: "User rejected permission request",
        data: { origin },
        cause: error,
      });
    }

    const grants = controllers.permissions.listGrants(origin);
    const getAccounts = (chainRef: string) =>
      controllers.permissions.getPermittedAccounts(origin, {
        namespace: activeChain.namespace,
        chainRef: chainRef as ChainRef,
      });
    return buildWalletPermissions({ origin, grants, getAccounts });
  },
};
