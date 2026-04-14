import { ArxReasons, arxError } from "@arx/errors";
import { ApprovalKinds } from "../../controllers/approval/types.js";
import { createApprovalSummaryBase } from "../presentation.js";
import {
  getApprovalSelectableAccounts,
  parseAccountSelectionDecision,
  resolveApprovalSelectedAccounts,
} from "../shared.js";
import type { ApprovalFlow } from "../types.js";

export const requestAccountsApprovalFlow: ApprovalFlow<typeof ApprovalKinds.RequestAccounts> = {
  kind: ApprovalKinds.RequestAccounts,
  parseDecision: (input) => parseAccountSelectionDecision(ApprovalKinds.RequestAccounts, input),
  present(record, deps) {
    const { selectableAccounts, recommendedAccountKey } = getApprovalSelectableAccounts(record, deps, {
      request: record.request,
    });

    return {
      ...createApprovalSummaryBase(record, deps, { request: record.request }),
      type: "requestAccounts",
      payload: {
        selectableAccounts: selectableAccounts.map((account) => ({
          accountKey: account.accountKey,
          canonicalAddress: account.canonicalAddress,
          displayAddress: account.displayAddress,
        })),
        recommendedAccountKey,
      },
    };
  },
  async approve(record, decision, deps) {
    const { namespace, chainRef, selectableAccounts } = getApprovalSelectableAccounts(record, deps, {
      request: record.request,
    });

    if (selectableAccounts.length === 0) {
      throw arxError({
        reason: ArxReasons.PermissionDenied,
        message: "No accounts available for connection request",
        data: { origin: record.origin, reason: "no_accounts", chainRef, namespace },
      });
    }

    const selectedAccounts = resolveApprovalSelectedAccounts({
      record,
      namespace,
      chainRef,
      decision,
      selectableAccounts,
    });

    await deps.permissions.grantAuthorization(record.origin, {
      namespace,
      chains: [
        {
          chainRef,
          accountKeys: selectedAccounts.map((account) => account.accountKey),
        },
      ],
    });

    return selectedAccounts.map((account) => account.displayAddress);
  },
};
