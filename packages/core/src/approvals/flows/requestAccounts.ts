import { ArxReasons, arxError } from "@arx/errors";
import { ApprovalKinds } from "../../controllers/approval/types.js";
import { createApprovalSummaryBase } from "../presentation.js";
import { deriveApprovalReviewContext, parseNoDecision } from "../shared.js";
import type { ApprovalFlow } from "../types.js";

export const requestAccountsApprovalFlow: ApprovalFlow<typeof ApprovalKinds.RequestAccounts> = {
  kind: ApprovalKinds.RequestAccounts,
  parseDecision: (input) => parseNoDecision(ApprovalKinds.RequestAccounts, input),
  present(record, deps) {
    return {
      ...createApprovalSummaryBase(record, deps, { request: record.request }),
      type: "requestAccounts",
      payload: {
        suggestedAccounts: (record.request.suggestedAccounts ?? []).map((value) => String(value)),
      },
    };
  },
  async approve(record, _decision, deps) {
    const payload = record.request;
    const { reviewChainRef, namespace } = deriveApprovalReviewContext(record, { request: payload });
    const chainRef = reviewChainRef;
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

    const existing = deps.permissions.getAuthorization(record.origin, { namespace });
    const nextChains = new Map<string, string[]>(
      Object.entries(existing?.chains ?? {}).map(([existingChainRef, chainState]) => [
        existingChainRef,
        [...chainState.accountIds],
      ]),
    );
    const currentAccountIds = nextChains.get(chainRef) ?? [];
    nextChains.set(chainRef, [...new Set([...currentAccountIds, selectedAccount.accountId])]);

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

    return [selectedAccount.displayAddress];
  },
};
