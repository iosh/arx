import { ArxReasons, arxError } from "@arx/errors";
import { parseChainRef } from "../chains/caip.js";
import type { ChainRef } from "../chains/ids.js";
import type { ApprovalDecision, ApprovalKind, ApprovalRecord } from "../controllers/approval/types.js";
import type { ApprovalFlowDeps } from "./types.js";

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
  deps: Pick<ApprovalFlowDeps, "network" | "networkPreferences">,
  request?: { chainRef?: ChainRef | undefined },
) => {
  const currentActiveChainRef = deps.network.getState().activeChainRef;
  const inferredNamespace =
    record.namespace ?? request?.chainRef?.split(":")[0] ?? record.chainRef?.split(":")[0] ?? null;
  const namespaceActiveChainRef = inferredNamespace
    ? deps.networkPreferences.getActiveChainRef(inferredNamespace)
    : null;
  const compatibleCurrentActiveChainRef =
    inferredNamespace && currentActiveChainRef.split(":")[0] !== inferredNamespace ? null : currentActiveChainRef;

  const requestedChainRef =
    request?.chainRef ?? record.chainRef ?? namespaceActiveChainRef ?? compatibleCurrentActiveChainRef;

  if (!requestedChainRef) {
    throw arxError({
      reason: ArxReasons.RpcInvalidParams,
      message: "Approval context could not resolve a chainRef.",
      data: { id: record.id, kind: record.kind, namespace: inferredNamespace },
    });
  }

  const parsed = parseChainRef(requestedChainRef);

  if (record.namespace && record.namespace !== parsed.namespace) {
    throw arxError({
      reason: ArxReasons.RpcInvalidParams,
      message: "Approval record has mismatched namespace and chainRef.",
      data: { id: record.id, kind: record.kind, namespace: record.namespace, chainRef: requestedChainRef },
    });
  }

  return {
    chainRef: `${parsed.namespace}:${parsed.reference}` as ChainRef,
    namespace: parsed.namespace,
  };
};
