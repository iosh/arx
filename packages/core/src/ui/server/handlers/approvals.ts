import { ArxReasons, arxError } from "@arx/errors";
import { toAccountIdFromAddress } from "../../../accounts/addressing/accountId.js";
import { parseChainRef } from "../../../chains/caip.js";
import { ApprovalTypes } from "../../../controllers/approval/types.js";
import { PermissionCapabilities } from "../../../controllers/permission/types.js";
import type { UiMethodResult } from "../../protocol/index.js";
import type { UiHandlers, UiRuntimeDeps } from "../types.js";
import { resolveChainRefForNamespace } from "./lib.js";

type ApprovalTask = {
  id: string;
  type: string;
  origin: string;
  chainRef?: string;
  namespace?: string;
  payload?: unknown;
};

type ApprovalResult = unknown;

type ApprovalHandlerFn = (
  task: ApprovalTask,
  deps: Pick<UiRuntimeDeps, "controllers" | "chains">,
) => Promise<ApprovalResult>;

const deriveChainContext = (
  task: { chainRef?: string; namespace?: string },
  deps: Pick<UiRuntimeDeps, "controllers" | "chains">,
) => {
  const active = deps.chains.getActiveChainView();

  if (task.chainRef) {
    const parsed = parseChainRef(task.chainRef);
    if (task.namespace && task.namespace !== parsed.namespace) {
      throw arxError({
        reason: ArxReasons.RpcInvalidParams,
        message: "Approval task has mismatched namespace and chainRef.",
        data: { namespace: task.namespace, chainRef: task.chainRef },
      });
    }
    return { chainRef: `${parsed.namespace}:${parsed.reference}`, namespace: parsed.namespace };
  }

  if (task.namespace) {
    if (active.namespace === task.namespace) {
      return { chainRef: active.chainRef, namespace: task.namespace };
    }

    try {
      return {
        chainRef: resolveChainRefForNamespace(deps, task.namespace),
        namespace: task.namespace,
      };
    } catch (error) {
      throw arxError({
        reason: ArxReasons.RpcInvalidParams,
        message: "Approval task is missing chainRef and cannot be resolved from namespace.",
        data: { namespace: task.namespace },
        cause: error,
      });
    }
  }

  return { chainRef: active.chainRef, namespace: active.namespace };
};

const approvalHandlers: Record<string, ApprovalHandlerFn> = {
  [ApprovalTypes.SendTransaction]: async (task, deps) => {
    const approved = await deps.controllers.transactions.approveTransaction(task.id);
    if (!approved) {
      throw arxError({
        reason: ArxReasons.RpcInvalidParams,
        message: "Transaction not found",
        data: { id: task.id },
      });
    }
    return approved;
  },

  [ApprovalTypes.RequestAccounts]: async (task, deps) => {
    const { chainRef, namespace } = deriveChainContext(task, deps);

    const accounts = await deps.controllers.accounts.requestAccounts({ chainRef });
    const uniqueAccounts = [...new Set(accounts)];
    if (uniqueAccounts.length === 0) {
      throw arxError({
        reason: ArxReasons.PermissionDenied,
        message: "No accounts available for connection request",
        data: { origin: task.origin, reason: "no_accounts" },
      });
    }

    const preferredAddress = deps.controllers.accounts.getSelectedAddressForNamespace({ namespace, chainRef });
    const preferred = preferredAddress && uniqueAccounts.includes(preferredAddress) ? preferredAddress : null;
    const selectedAccount = preferred ?? uniqueAccounts[0] ?? null;
    if (!selectedAccount) {
      throw arxError({
        reason: ArxReasons.PermissionDenied,
        message: "No selectable account available for connection request",
        data: { origin: task.origin, reason: "no_selection" },
      });
    }

    await deps.controllers.permissions.grant(task.origin, PermissionCapabilities.Basic, { namespace, chainRef });
    await deps.controllers.permissions.setPermittedAccounts(task.origin, {
      namespace,
      chainRef,
      accounts: [selectedAccount],
    });
    return [selectedAccount];
  },

  [ApprovalTypes.SignMessage]: async (task, deps) => {
    const payload = task.payload as { from: string; message: string };
    const { chainRef, namespace } = deriveChainContext(task, deps);
    if (namespace !== "eip155") {
      throw arxError({
        reason: ArxReasons.ChainNotCompatible,
        message: `SignMessage is not supported for namespace "${namespace}".`,
        data: { namespace, chainRef },
      });
    }

    const signature = await deps.controllers.signers.eip155.signPersonalMessage({
      accountId: toAccountIdFromAddress({ chainRef, address: payload.from }),
      message: payload.message,
    });

    await deps.controllers.permissions.grant(task.origin, PermissionCapabilities.Sign, { namespace, chainRef });
    return signature;
  },

  [ApprovalTypes.SignTypedData]: async (task, deps) => {
    const payload = task.payload as { from: string; typedData: unknown };
    const { chainRef, namespace } = deriveChainContext(task, deps);
    if (namespace !== "eip155") {
      throw arxError({
        reason: ArxReasons.ChainNotCompatible,
        message: `SignTypedData is not supported for namespace "${namespace}".`,
        data: { namespace, chainRef },
      });
    }

    const typedDataStr = typeof payload.typedData === "string" ? payload.typedData : JSON.stringify(payload.typedData);

    const signature = await deps.controllers.signers.eip155.signTypedData({
      accountId: toAccountIdFromAddress({ chainRef, address: payload.from }),
      typedData: typedDataStr,
    });

    await deps.controllers.permissions.grant(task.origin, PermissionCapabilities.Sign, { namespace, chainRef });
    return signature;
  },

  [ApprovalTypes.RequestPermissions]: async (task) => {
    const payload = task.payload as { requested: unknown[] };
    return { granted: payload.requested };
  },

  [ApprovalTypes.SwitchChain]: async (task, deps) => {
    const payload = task.payload as { chainRef?: string };
    const requested = payload.chainRef ?? task.chainRef;
    if (!requested) {
      throw arxError({
        reason: ArxReasons.RpcInvalidParams,
        message: "Switch chain approval is missing chainRef",
        data: { id: task.id },
      });
    }

    await deps.controllers.network.switchChain(requested as Parameters<typeof deps.controllers.network.switchChain>[0]);
    return null;
  },

  [ApprovalTypes.AddChain]: async (task, deps) => {
    const payload = task.payload as { metadata: unknown };
    await deps.controllers.chainDefinitions.upsertChain(
      payload.metadata as Parameters<typeof deps.controllers.chainDefinitions.upsertChain>[0],
    );
    return null;
  },
};

export const createApprovalsHandlers = (
  deps: Pick<UiRuntimeDeps, "controllers" | "chains">,
): Pick<UiHandlers, "ui.approvals.approve" | "ui.approvals.reject"> => {
  return {
    "ui.approvals.approve": async ({ id }) => {
      const task = deps.controllers.approvals.get(id);
      if (!task) {
        throw arxError({ reason: ArxReasons.RpcInvalidParams, message: "Approval not found", data: { id } });
      }

      const handler = approvalHandlers[task.type];
      if (!handler) {
        throw arxError({
          reason: ArxReasons.RpcUnsupportedMethod,
          message: `Unsupported approval type: ${task.type}`,
          data: { id, type: task.type },
        });
      }

      const result = await deps.controllers.approvals.resolve(task.id, () => handler(task as ApprovalTask, deps));
      return { id: task.id, result: result as UiMethodResult<"ui.approvals.approve">["result"] };
    },

    "ui.approvals.reject": async ({ id, reason }) => {
      const task = deps.controllers.approvals.get(id);
      if (!task) {
        throw arxError({ reason: ArxReasons.RpcInvalidParams, message: "Approval not found", data: { id } });
      }

      const err = arxError({
        reason: ArxReasons.ApprovalRejected,
        message: reason ?? "User rejected the request.",
        data: { id: task.id, origin: task.origin, type: task.type },
      });

      if (task.type === ApprovalTypes.SendTransaction) {
        try {
          await deps.controllers.transactions.rejectTransaction(task.id, err);
        } catch {
          // best-effort
        }
      }

      deps.controllers.approvals.reject(task.id, err);
      return { id: task.id };
    },
  };
};
