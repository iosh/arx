import { ArxReasons, arxError } from "@arx/errors";
import { ApprovalKinds } from "../../controllers/approval/types.js";
import { PermissionCapabilities } from "../../controllers/permission/types.js";
import { createApprovalSummaryBase } from "../presentation.js";
import { ApprovalChainDerivationFallbacks, deriveApprovalChainContext, parseNoDecision } from "../shared.js";
import type { ApprovalFlow } from "../types.js";

export const requestAccountsApprovalFlow: ApprovalFlow<typeof ApprovalKinds.RequestAccounts> = {
  kind: ApprovalKinds.RequestAccounts,
  parseDecision: (input) => parseNoDecision(ApprovalKinds.RequestAccounts, input),
  present(record, deps) {
    return {
      ...createApprovalSummaryBase(record, deps),
      type: "requestAccounts",
      payload: {
        suggestedAccounts: (record.request.suggestedAccounts ?? []).map((value) => String(value)),
      },
    };
  },
  async approve(record, _decision, deps) {
    const payload = record.request;
    const { chainRef, namespace } = deriveApprovalChainContext(record, deps, {
      request: payload,
      fallback: ApprovalChainDerivationFallbacks.NamespaceActive,
    });
    const accounts = deps.accounts.listOwnedForNamespace({ namespace, chainRef });

    if (accounts.length === 0) {
      throw arxError({
        reason: ArxReasons.PermissionDenied,
        message: "No accounts available for connection request",
        data: { origin: record.origin, reason: "no_accounts", chainRef, namespace },
      });
    }

    const activeAccount = deps.accounts.getActiveAccountForNamespace({ namespace, chainRef });
    const selectedAccount =
      (activeAccount && accounts.find((account) => account.accountId === activeAccount.accountId)) ??
      accounts[0] ??
      null;

    if (!selectedAccount) {
      throw arxError({
        reason: ArxReasons.PermissionDenied,
        message: "No selectable account available for connection request",
        data: { origin: record.origin, reason: "no_selection", chainRef, namespace },
      });
    }

    await deps.permissions.grant(record.origin, PermissionCapabilities.Basic, { namespace, chainRef });
    await deps.permissions.setPermittedAccounts(record.origin, {
      namespace,
      chainRef,
      accounts: [selectedAccount.canonicalAddress],
    });

    return [selectedAccount.displayAddress];
  },
};
