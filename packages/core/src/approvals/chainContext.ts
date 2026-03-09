import { ArxReasons, arxError } from "@arx/errors";
import { parseChainRef } from "../chains/caip.js";
import type { ChainRef } from "../chains/ids.js";

export const ApprovalChainDerivationFallbacks = {
  None: "none",
  NamespaceActive: "namespace-active",
} as const;

export type ApprovalChainDerivationFallback =
  (typeof ApprovalChainDerivationFallbacks)[keyof typeof ApprovalChainDerivationFallbacks];

export type ApprovalChainContextRecord = {
  id: string;
  kind: string;
  namespace?: string | undefined;
  chainRef?: ChainRef | undefined;
};

export type ApprovalChainContextRequest = {
  chainRef?: ChainRef | undefined;
};

export type ApprovalChainContextSource = "request" | "record" | "provider-selection";

export type DerivedApprovalChainContext = {
  chainRef: ChainRef;
  namespace: string;
  source: ApprovalChainContextSource;
};

export type DeriveApprovalChainContextOptions = {
  request?: ApprovalChainContextRequest;
  fallback?: ApprovalChainDerivationFallback;
  getNamespaceActiveChainRef?: (namespace: string) => ChainRef | null;
};

export const deriveApprovalChainContext = (
  record: ApprovalChainContextRecord,
  options?: DeriveApprovalChainContextOptions,
): DerivedApprovalChainContext => {
  const requestChainRef = options?.request?.chainRef ?? null;
  const recordChainRef = record.chainRef ?? null;
  const inferredNamespace = record.namespace ?? requestChainRef?.split(":")[0] ?? recordChainRef?.split(":")[0] ?? null;

  const namespaceActiveChainRef =
    inferredNamespace && options?.fallback === ApprovalChainDerivationFallbacks.NamespaceActive
      ? (options.getNamespaceActiveChainRef?.(inferredNamespace) ?? null)
      : null;

  const resolvedChainRef = requestChainRef ?? recordChainRef ?? namespaceActiveChainRef;

  if (!resolvedChainRef) {
    throw arxError({
      reason: ArxReasons.RpcInvalidParams,
      message: "Approval context could not resolve a chainRef.",
      data: { id: record.id, kind: record.kind, namespace: inferredNamespace },
    });
  }

  const parsed = parseChainRef(resolvedChainRef);

  if (record.namespace && record.namespace !== parsed.namespace) {
    throw arxError({
      reason: ArxReasons.RpcInvalidParams,
      message: "Approval record has mismatched namespace and chainRef.",
      data: { id: record.id, kind: record.kind, namespace: record.namespace, chainRef: resolvedChainRef },
    });
  }

  return {
    chainRef: `${parsed.namespace}:${parsed.reference}` as ChainRef,
    namespace: parsed.namespace,
    source: requestChainRef ? "request" : recordChainRef ? "record" : "provider-selection",
  };
};
