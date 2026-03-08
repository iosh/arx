import { ArxReasons, arxError } from "@arx/errors";
import { toAccountIdFromAddress } from "../../../accounts/addressing/accountId.js";
import { parseChainRef } from "../../../chains/caip.js";
import { ApprovalKinds } from "../../../controllers/approval/types.js";
import { PermissionCapabilities } from "../../../controllers/permission/types.js";
import type { UiMethodResult } from "../../protocol/index.js";
import type { UiHandlers, UiRuntimeDeps } from "../types.js";
import { resolveChainRefForNamespace } from "./lib.js";

type ApprovalRecordLike = {
  id: string;
  kind: string;
  origin: string;
  chainRef?: string;
  namespace?: string;
  request?: unknown;
};

type ApprovalResult = unknown;

type ApprovalHandlerFn = (
  task: ApprovalRecordLike,
  deps: Pick<UiRuntimeDeps, "controllers" | "chainViews">,
) => Promise<ApprovalResult>;

const deriveChainContext = (
  task: { chainRef?: string; namespace?: string },
  deps: Pick<UiRuntimeDeps, "controllers" | "chainViews">,
) => {
  const active = deps.chainViews.getActiveChainView();

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
  [ApprovalKinds.SendTransaction]: async (task, deps) => {
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

  [ApprovalKinds.RequestAccounts]: async (task, deps) => {
    const { chainRef, namespace } = deriveChainContext(task, deps);

    const accounts = deps.controllers.accounts.listOwnedForNamespace({ namespace, chainRef });
    if (accounts.length === 0) {
      throw arxError({
        reason: ArxReasons.PermissionDenied,
        message: "No accounts available for connection request",
        data: { origin: task.origin, reason: "no_accounts" },
      });
    }

    const activeAccount = deps.controllers.accounts.getActiveAccountForNamespace({ namespace, chainRef });
    const selectedAccount =
      (activeAccount && accounts.find((account) => account.accountId === activeAccount.accountId)) ??
      accounts[0] ??
      null;
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
      accounts: [selectedAccount.canonicalAddress],
    });
    return [selectedAccount.displayAddress];
  },

  [ApprovalKinds.SignMessage]: async (task, deps) => {
    const payload = task.request as { from: string; message: string };
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

  [ApprovalKinds.SignTypedData]: async (task, deps) => {
    const payload = task.request as { from: string; typedData: unknown };
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

  [ApprovalKinds.RequestPermissions]: async (task) => {
    const payload = task.request as { requested: unknown[] };
    return { granted: payload.requested };
  },

  [ApprovalKinds.SwitchChain]: async (task, deps) => {
    const payload = task.request as { chainRef?: string };
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

  [ApprovalKinds.AddChain]: async (task, deps) => {
    const payload = task.request as { metadata: unknown };
    await deps.controllers.chainDefinitions.upsertChain(
      payload.metadata as Parameters<typeof deps.controllers.chainDefinitions.upsertChain>[0],
    );
    return null;
  },
};

export const createApprovalsHandlers = (
  deps: Pick<UiRuntimeDeps, "controllers" | "chainViews">,
): Pick<UiHandlers, "ui.approvals.approve" | "ui.approvals.reject"> => {
  return {
    "ui.approvals.approve": async ({ id }) => {
      const task = deps.controllers.approvals.get(id);
      if (!task) {
        throw arxError({ reason: ArxReasons.RpcInvalidParams, message: "Approval not found", data: { id } });
      }

      const handler = approvalHandlers[task.kind];
      if (!handler) {
        throw arxError({
          reason: ArxReasons.RpcUnsupportedMethod,
          message: `Unsupported approval kind: ${task.kind}`,
          data: { id, kind: task.kind },
        });
      }

      try {
        const result = await handler(task as ApprovalRecordLike, deps);
        await deps.controllers.approvals.resolve({ id: task.id, action: "approve", result });
        return { id: task.id, result: result as UiMethodResult<"ui.approvals.approve">["result"] };
      } catch (error) {
        const err = error instanceof Error ? error : new Error(String(error));
        await deps.controllers.approvals.cancel({ id: task.id, reason: "internal_error", error: err });
        throw err;
      }
    },

    "ui.approvals.reject": async ({ id, reason }) => {
      const task = deps.controllers.approvals.get(id);
      if (!task) {
        throw arxError({ reason: ArxReasons.RpcInvalidParams, message: "Approval not found", data: { id } });
      }

      const err = arxError({
        reason: ArxReasons.ApprovalRejected,
        message: reason ?? "User rejected the request.",
        data: { id: task.id, origin: task.origin, kind: task.kind },
      });

      if (task.kind === ApprovalKinds.SendTransaction) {
        try {
          await deps.controllers.transactions.rejectTransaction(task.id, err);
        } catch {
          // best-effort
        }
      }

      await deps.controllers.approvals.resolve({
        id: task.id,
        action: "reject",
        ...(reason !== undefined ? { reason } : {}),
        error: err,
      });
      return { id: task.id };
    },
  };
};
