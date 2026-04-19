import { ArxReasons, arxError } from "@arx/errors";
import { parseChainRef } from "../chains/caip.js";
import {
  type ApprovalController,
  type ApprovalHandle,
  type ApprovalKind,
  ApprovalKinds,
  type ApprovalRequest,
} from "../controllers/approval/types.js";
import { toApprovalRequester } from "../controllers/approval/utils.js";
import type { RequestContext } from "../rpc/requestContext.js";

export type ApprovalCreationDeps = {
  approvals: Pick<ApprovalController, "create">;
  now: () => number;
};

export type ApprovalCreationInput<K extends ApprovalKind = ApprovalKind> = {
  kind: K;
  request: ApprovalRequest<K>;
  requestContext: RequestContext;
  approvalId?: string;
  createdAt?: number;
};

const deriveApprovalRecordContext = <K extends ApprovalKind>(input: ApprovalCreationInput<K>) => {
  // Creator owns record-level context derivation so call sites only provide kind-specific payload.
  if (input.kind === ApprovalKinds.AddChain) {
    const request = input.request as ApprovalRequest<typeof ApprovalKinds.AddChain>;

    return {
      chainRef: request.metadata.chainRef,
      namespace: request.metadata.namespace,
    };
  }

  const request = input.request as Extract<ApprovalRequest, { chainRef: string }>;
  const chain = parseChainRef(request.chainRef);

  return {
    chainRef: request.chainRef,
    namespace: chain.namespace,
  };
};

const assertApprovalRequestConsistency = <K extends ApprovalKind>(input: ApprovalCreationInput<K>) => {
  if (input.kind !== ApprovalKinds.SendTransaction) {
    return;
  }

  // Transaction approvals keep origin in their payload for downstream review/execution.
  // Keep it aligned with the requester origin before the approval enters pending state.
  const request = input.request as ApprovalRequest<typeof ApprovalKinds.SendTransaction>;
  if (request.origin === input.requestContext.origin) {
    return;
  }

  throw arxError({
    reason: ArxReasons.RpcInvalidParams,
    message: "Transaction approval request origin must match the requester origin.",
    data: {
      kind: input.kind,
      requestOrigin: request.origin,
      requesterOrigin: input.requestContext.origin,
    },
  });
};

export const requestApproval = <K extends ApprovalKind>(
  deps: ApprovalCreationDeps,
  input: ApprovalCreationInput<K>,
): ApprovalHandle<K> => {
  assertApprovalRequestConsistency(input);

  const requester = toApprovalRequester(input.requestContext);
  const context = deriveApprovalRecordContext(input);

  return deps.approvals.create(
    {
      approvalId: input.approvalId ?? globalThis.crypto.randomUUID(),
      kind: input.kind,
      origin: requester.origin,
      namespace: context.namespace,
      chainRef: context.chainRef,
      request: input.request,
      createdAt: input.createdAt ?? deps.now(),
    },
    requester,
  );
};
