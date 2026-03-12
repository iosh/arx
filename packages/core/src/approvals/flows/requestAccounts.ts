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
    const { selectableAccounts, recommendedAccountId } = getApprovalSelectableAccounts(record, deps, {
      request: record.request,
    });

    return {
      ...createApprovalSummaryBase(record, deps, { request: record.request }),
      type: "requestAccounts",
      payload: {
        selectableAccounts: selectableAccounts.map((account) => ({
          accountId: account.accountId,
          canonicalAddress: account.canonicalAddress,
          displayAddress: account.displayAddress,
        })),
        recommendedAccountId,
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

    const existing = deps.permissions.getAuthorization(record.origin, { namespace });
    const nextChains = new Map<string, string[]>(
      Object.entries(existing?.chains ?? {}).map(([existingChainRef, chainState]) => [
        existingChainRef,
        [...chainState.accountIds],
      ]),
    );
    nextChains.set(
      chainRef,
      selectedAccounts.map((account) => account.accountId),
    );

    await deps.permissions.upsertAuthorization(record.origin, {
      namespace,
      chains: [...nextChains.entries()]
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([entryChainRef, accountIds]) => ({
          chainRef: entryChainRef as typeof chainRef,
          accountIds,
        })) as [
        { chainRef: typeof chainRef; accountIds: string[] },
        ...Array<{ chainRef: typeof chainRef; accountIds: string[] }>,
      ],
    });

    return selectedAccounts.map((account) => account.displayAddress);
  },
};
