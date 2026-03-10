import { ArxReasons, arxError } from "@arx/errors";
import { parseChainRef } from "../chains/caip.js";
import type { ChainRef } from "../chains/ids.js";

export type ApprovalChainContextRecord = {
  id: string;
  kind: string;
  namespace: string;
  chainRef: ChainRef;
};

export type ApprovalChainContextRequest = {
  chainRef?: ChainRef | undefined;
};

export type ApprovalChainContextSource = "request" | "record";

export type ApprovalReviewContext = {
  reviewChainRef: ChainRef;
  namespace: string;
  source: ApprovalChainContextSource;
};

export type DeriveApprovalReviewContextOptions = {
  request?: ApprovalChainContextRequest;
};

export const deriveApprovalReviewContext = (
  record: ApprovalChainContextRecord,
  options?: DeriveApprovalReviewContextOptions,
): ApprovalReviewContext => {
  const resolvedChainRef = options?.request?.chainRef ?? record.chainRef;
  const parsed = parseChainRef(resolvedChainRef);

  if (record.namespace !== parsed.namespace) {
    throw arxError({
      reason: ArxReasons.RpcInvalidParams,
      message: "Approval record has mismatched namespace and chainRef.",
      data: { id: record.id, kind: record.kind, namespace: record.namespace, chainRef: resolvedChainRef },
    });
  }

  return {
    reviewChainRef: `${parsed.namespace}:${parsed.reference}` as ChainRef,
    namespace: parsed.namespace,
    source: options?.request?.chainRef ? "request" : "record",
  };
};

export const deriveApprovalChainContext = (
  record: ApprovalChainContextRecord,
  options?: DeriveApprovalReviewContextOptions,
): {
  chainRef: ChainRef;
  namespace: string;
  source: ApprovalChainContextSource;
} => {
  const context = deriveApprovalReviewContext(record, options);

  return {
    chainRef: context.reviewChainRef,
    namespace: context.namespace,
    source: context.source,
  };
};
