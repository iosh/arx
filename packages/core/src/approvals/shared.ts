import { ArxReasons, arxError } from "@arx/errors";
import { ZodError, z } from "zod";
import type {
  ApprovalAccountSelectionDecision,
  ApprovalDecision,
  ApprovalKind,
  ApprovalRecord,
} from "../controllers/approval/types.js";
import { AccountKeySchema } from "../storage/records.js";
import { deriveApprovalReviewContext as deriveApprovalReviewContextBase } from "./chainContext.js";
import type { ApprovalFlowPresenterDeps } from "./types.js";

type DeriveApprovalReviewContextOptions = {
  request?: { chainRef?: ApprovalRecord["chainRef"] | undefined };
};

const ApprovalAccountSelectionDecisionSchema = z
  .strictObject({
    accountKeys: z.array(AccountKeySchema).min(1),
  })
  .superRefine((value, ctx) => {
    if (new Set(value.accountKeys).size !== value.accountKeys.length) {
      ctx.addIssue({
        code: "custom",
        message: "decision.accountKeys must not contain duplicates",
        path: ["accountKeys"],
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
      message: `Approval kind "${kind}" requires a non-empty accountKeys decision.`,
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
      throw arxError({
        reason: ArxReasons.PermissionDenied,
        message: `Approval decision contains an unselectable account "${accountKey}"`,
        data: {
          origin: args.record.origin,
          kind: args.record.kind,
          namespace: args.namespace,
          chainRef: args.chainRef,
          accountKey,
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
