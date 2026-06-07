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
import { ApprovalAccountSelectionDecisionSchema } from "./decision.js";

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
  try {
    return ApprovalAccountSelectionDecisionSchema.parse(input) as ApprovalDecision<K>;
  } catch (error) {
    throw new RpcInvalidParamsError({
      message: `Approval kind "${kind}" requires a non-empty accountKeys decision.`,
      cause: error,
    });
  }
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
  const recommendedAccountKey =
    activeAccount && selectableAccounts.some((account) => account.accountKey === activeAccount.accountKey)
      ? activeAccount.accountKey
      : (selectableAccounts[0]?.accountKey ?? null);

  return {
    namespace,
    chainRef: reviewChainRef,
    selectableAccounts,
    recommendedAccountKey,
  };
};

export const resolveApprovalSelectedAccounts = (args: {
  record: Pick<ApprovalRecord, "kind" | "origin">;
  namespace: string;
  chainRef: ApprovalRecord["chainRef"];
  decision: ApprovalAccountSelectionDecision;
  selectableAccounts: ReturnType<typeof getApprovalSelectableAccounts>["selectableAccounts"];
}) => {
  const byKey = new Map(args.selectableAccounts.map((account) => [account.accountKey, account] as const));
  const selected = args.decision.accountKeys.map((accountKey) => {
    const account = byKey.get(accountKey);
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
