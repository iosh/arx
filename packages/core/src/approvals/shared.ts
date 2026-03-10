import { ArxReasons, arxError } from "@arx/errors";
import type { ApprovalDecision, ApprovalKind, ApprovalRecord } from "../controllers/approval/types.js";
import { deriveApprovalReviewContext as deriveApprovalReviewContextBase } from "./chainContext.js";

type DeriveApprovalReviewContextOptions = {
  request?: { chainRef?: ApprovalRecord["chainRef"] | undefined };
};

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

export const deriveApprovalReviewContext = (
  record: Pick<ApprovalRecord, "id" | "kind" | "namespace" | "chainRef">,
  options?: DeriveApprovalReviewContextOptions,
) => {
  return deriveApprovalReviewContextBase(record, options);
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
