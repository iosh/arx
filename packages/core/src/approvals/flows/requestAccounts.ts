import { ApprovalKinds } from "../../approvals/queue/types.js";
import { PermissionDeniedError } from "../../permissions/errors.js";
import {
  getApprovalSelectableAccounts,
  parseAccountSelectionDecision,
  resolveApprovalSelectedAccounts,
} from "../shared.js";
import type { ApprovalFlow } from "../types.js";

export const requestAccountsApprovalFlow: ApprovalFlow<typeof ApprovalKinds.RequestAccounts> = {
  kind: ApprovalKinds.RequestAccounts,
  parseDecision: (input) => parseAccountSelectionDecision(ApprovalKinds.RequestAccounts, input),
  async approve(record, decision, deps) {
    const { namespace, chainRef, selectableAccounts } = getApprovalSelectableAccounts(record, deps, {
      request: record.request,
    });

    if (selectableAccounts.length === 0) {
      throw new PermissionDeniedError();
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
