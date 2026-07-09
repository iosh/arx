import type { AccountSelectionService } from "../accounts/selection/types.js";
import type { ApprovalAccountSelectionDecision, ApprovalRecord } from "../approvals/queue/types.js";
import { PermissionDeniedError } from "../permissions/errors.js";
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
    accounts: Pick<AccountSelectionService, "getActiveAccountForNamespace" | "listOwnedForNamespace">;
  },
  options?: DeriveApprovalReviewContextOptions,
) => {
  const { reviewChainRef, namespace } = deriveApprovalReviewContext(record, options);
  const selectableAccounts = deps.accounts.listOwnedForNamespace({
    namespace,
    chainRef: reviewChainRef,
  });
  const activeAccount = deps.accounts.getActiveAccountForNamespace({
    namespace,
    chainRef: reviewChainRef,
  });
  const recommendedAccountId =
    activeAccount && selectableAccounts.some((account) => account.accountId === activeAccount.accountId)
      ? activeAccount.accountId
      : (selectableAccounts[0]?.accountId ?? null);

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
      throw new PermissionDeniedError();
    }
    return account;
  });

  return selected;
};
