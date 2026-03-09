import { ArxReasons, arxError } from "@arx/errors";
import type { ApprovalDecision, ApprovalKind, ApprovalRecord } from "../controllers/approval/types.js";
import {
  type ApprovalChainDerivationFallback,
  ApprovalChainDerivationFallbacks,
  deriveApprovalChainContext as deriveApprovalChainContextBase,
} from "./chainContext.js";
import type { ApprovalFlowDeps } from "./types.js";

type DeriveApprovalChainContextOptions = {
  request?: { chainRef?: ApprovalRecord["chainRef"] | undefined };
  fallback?: ApprovalChainDerivationFallback;
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

export const deriveApprovalChainContext = (
  record: Pick<ApprovalRecord, "id" | "kind" | "namespace" | "chainRef">,
  deps: Pick<ApprovalFlowDeps, "networkPreferences">,
  options?: DeriveApprovalChainContextOptions,
) => {
  const context = deriveApprovalChainContextBase(record, {
    ...(options?.request ? { request: options.request } : {}),
    ...(options?.fallback ? { fallback: options.fallback } : {}),
    getNamespaceActiveChainRef: (namespace) => deps.networkPreferences.getActiveChainRef(namespace),
  });

  return {
    chainRef: context.chainRef,
    namespace: context.namespace,
  };
};

export { ApprovalChainDerivationFallbacks };
export type { ApprovalChainDerivationFallback };
