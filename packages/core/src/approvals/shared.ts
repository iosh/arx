import { ArxReasons, arxError } from "@arx/errors";
import { ZodError, z } from "zod";
import type {
  ApprovalAccountSelectionDecision,
  ApprovalDecision,
  ApprovalKind,
  ApprovalRecord,
} from "../controllers/approval/types.js";
import { AccountIdSchema } from "../storage/records.js";
import { deriveApprovalReviewContext as deriveApprovalReviewContextBase } from "./chainContext.js";
import type { ApprovalFlowPresenterDeps } from "./types.js";

type DeriveApprovalReviewContextOptions = {
  request?: { chainRef?: ApprovalRecord["chainRef"] | undefined };
};

const ApprovalAccountSelectionDecisionSchema = z
  .strictObject({
    accountIds: z.array(AccountIdSchema).min(1),
  })
  .superRefine((value, ctx) => {
    if (new Set(value.accountIds).size !== value.accountIds.length) {
      ctx.addIssue({
        code: "custom",
        message: "decision.accountIds must not contain duplicates",
        path: ["accountIds"],
      });
    }
  });

export const parseNoDecision = <K extends ApprovalKind>(kind: K, input: unknown): ApprovalDecision<K> => {
  if (input !== undefined) {
    throw arxError({
      reason: ArxReasons.RpcInvalidParams,
      message: `Approval kind "${kind}" does not accept a decision payload.`,
      data: { kind, decision: input },
    });
  }

  return undefined as ApprovalDecision<K>;
};

export const parseAccountSelectionDecision = <K extends ApprovalKind>(kind: K, input: unknown): ApprovalDecision<K> => {
  try {
    return ApprovalAccountSelectionDecisionSchema.parse(input) as ApprovalDecision<K>;
  } catch (error) {
    throw arxError({
      reason: ArxReasons.RpcInvalidParams,
      message: `Approval kind "${kind}" requires a non-empty accountIds decision.`,
      data: { kind, decision: input },
      ...(error instanceof ZodError ? { cause: error } : {}),
    });
  }
};

export const deriveApprovalReviewContext = (
  record: Pick<ApprovalRecord, "id" | "kind" | "namespace" | "chainRef">,
  options?: DeriveApprovalReviewContextOptions,
) => {
  return deriveApprovalReviewContextBase(record, options);
};

export const getApprovalSelectableAccounts = (
  record: Pick<ApprovalRecord, "id" | "kind" | "namespace" | "chainRef">,
  deps: Pick<ApprovalFlowPresenterDeps, "accounts">,
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
  const byId = new Map(args.selectableAccounts.map((account) => [account.accountId, account] as const));
  const selected = args.decision.accountIds.map((accountId) => {
    const account = byId.get(accountId);
    if (!account) {
      throw arxError({
        reason: ArxReasons.PermissionDenied,
        message: `Approval decision contains an unselectable account "${accountId}"`,
        data: {
          origin: args.record.origin,
          kind: args.record.kind,
          namespace: args.namespace,
          chainRef: args.chainRef,
          accountId,
        },
      });
    }
    return account;
  });

  return selected;
};

export const deriveApprovalChainContext = (
  record: Pick<ApprovalRecord, "id" | "kind" | "namespace" | "chainRef">,
  options?: DeriveApprovalReviewContextOptions,
) => {
  const context = deriveApprovalReviewContext(record, options);

  return {
    chainRef: context.reviewChainRef,
    namespace: context.namespace,
  };
};
