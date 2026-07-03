import type { AccountSelectionService } from "../accounts/runtime/types.js";
import type {
  ApprovalAccountSelectionDecision,
  ApprovalDecision,
  ApprovalQueueKind,
  ApprovalRecord,
} from "../approvals/queue/types.js";
import { PermissionDeniedError } from "../permissions/errors.js";
import { RpcInvalidParamsError } from "../rpc/errors.js";
import { deriveApprovalReviewContext as deriveApprovalReviewContextBase } from "./chainContext.js";

type DeriveApprovalReviewContextOptions = {
  request?: { chainRef?: ApprovalRecord["chainRef"] | undefined };
};

export const parseNoDecision = <K extends ApprovalQueueKind>(kind: K, input: unknown): ApprovalDecision<K> => {
  if (input !== undefined) {
    throw new RpcInvalidParamsError({
      message: `Approval kind "${kind}" does not accept a decision payload.`,
    });
  }

  return undefined as ApprovalDecision<K>;
};

export const parseAccountSelectionDecision = <K extends ApprovalQueueKind>(
  kind: K,
  input: unknown,
): ApprovalDecision<K> => {
  const decision = input as Partial<ApprovalAccountSelectionDecision> | undefined;
  if (!decision?.accountIds?.length) {
    throw new RpcInvalidParamsError({
      message: `Approval kind "${kind}" requires a non-empty accountIds decision.`,
    });
  }

  return decision as ApprovalDecision<K>;
};

export const deriveApprovalReviewContext = (
  record: Pick<ApprovalRecord, "approvalId" | "kind" | "namespace" | "chainRef">,
  options?: DeriveApprovalReviewContextOptions,
) => {
  return deriveApprovalReviewContextBase(record, options);
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
  decision: ApprovalAccountSelectionDecision;
  selectableAccounts: ReturnType<typeof getApprovalSelectableAccounts>["selectableAccounts"];
}) => {
  const byKey = new Map(args.selectableAccounts.map((account) => [account.accountId, account] as const));
  const selected = args.decision.accountIds.map((accountId) => {
    const account = byKey.get(accountId);
    if (!account) {
      throw new PermissionDeniedError();
    }
    return account;
  });

  return selected;
};

export const deriveApprovalChainContext = (
  record: Pick<ApprovalRecord, "approvalId" | "kind" | "namespace" | "chainRef">,
  options?: DeriveApprovalReviewContextOptions,
) => {
  const context = deriveApprovalReviewContext(record, options);

  return {
    chainRef: context.reviewChainRef,
    namespace: context.namespace,
  };
};
