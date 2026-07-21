import type { Accounts } from "../accounts/Accounts.js";
import type { ApprovalAccountSelectionDecision, ApprovalRecord } from "../approvals/queue/types.js";
import { RpcInvalidParamsError } from "../rpc/errors.js";
import { deriveApprovalReviewContext } from "./chainContext.js";

type DeriveApprovalReviewContextOptions = {
  request?: { chainRef?: ApprovalRecord["chainRef"] | undefined };
};

const requireAccountSelectionDecision = (
  kind: ApprovalRecord["kind"],
  input: unknown,
): ApprovalAccountSelectionDecision => {
  const decision = input as Partial<ApprovalAccountSelectionDecision> | undefined;
  if (!decision?.accountIds?.length) {
    throw new RpcInvalidParamsError({
      message: `Approval kind "${kind}" requires a non-empty accountIds decision.`,
    });
  }

  return decision as ApprovalAccountSelectionDecision;
};

export const getApprovalSelectableAccounts = (
  record: Pick<ApprovalRecord, "approvalId" | "kind" | "namespace" | "chainRef">,
  deps: {
    accounts: Pick<Accounts, "getSelectedAddress" | "listSelectableAddresses">;
  },
  options?: DeriveApprovalReviewContextOptions,
) => {
  const { reviewChainRef, namespace } = deriveApprovalReviewContext(record, options);
  const selectableAccounts = deps.accounts.listSelectableAddresses(reviewChainRef);
  const recommendedAccountId = deps.accounts.getSelectedAddress(reviewChainRef).accountId;

  return {
    namespace,
    chainRef: reviewChainRef,
    selectableAccounts,
    recommendedAccountId,
  };
};

export const resolveApprovalSelectedAccounts = (args: {
  record: Pick<ApprovalRecord, "kind" | "origin">;
  namespace: string;
  chainRef: ApprovalRecord["chainRef"];
  decision: unknown;
  selectableAccounts: ReturnType<typeof getApprovalSelectableAccounts>["selectableAccounts"];
}) => {
  const decision = requireAccountSelectionDecision(args.record.kind, args.decision);
  const byKey = new Map(args.selectableAccounts.map((account) => [account.accountId, account] as const));
  const selected = decision.accountIds.map((accountId) => {
    const account = byKey.get(accountId);
    if (!account) {
      throw new RpcInvalidParamsError({ message: `Account "${accountId}" is not selectable for this approval.` });
    }
    return account;
  });

  return selected;
};
