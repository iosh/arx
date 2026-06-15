import {
  type ApprovalCreateParams,
  type ApprovalHandle,
  ApprovalKinds,
  type ApprovalQueueKind,
  type ApprovalQueueService,
  type ApprovalRequest,
  type ApprovalRequester,
} from "../approvals/queue/types.js";
import { parseChainRef } from "../chains/caip.js";

export type ApprovalCreationDeps = {
  approvals: Pick<ApprovalQueueService, "create">;
  now: () => number;
};

export type ApprovalCreationInput<K extends ApprovalQueueKind = ApprovalQueueKind> = {
  kind: K;
  request: ApprovalRequest<K>;
  requester: ApprovalRequester;
  approvalId?: string;
  createdAt?: number;
};

const deriveApprovalRecordContext = <K extends ApprovalQueueKind>(input: ApprovalCreationInput<K>) => {
  // Creator owns record-level context derivation so call sites only provide kind-specific payload.
  if (input.kind === ApprovalKinds.AddChain) {
    const request = input.request as ApprovalRequest<typeof ApprovalKinds.AddChain>;

    return {
      chainRef: request.definition.chainRef,
      namespace: parseChainRef(request.definition.chainRef).namespace,
    };
  }

  const request = input.request as Extract<ApprovalRequest, { chainRef: string }>;
  const chain = parseChainRef(request.chainRef);

  return {
    chainRef: request.chainRef,
    namespace: chain.namespace,
  };
};

export const requestApproval = <K extends ApprovalQueueKind>(
  deps: ApprovalCreationDeps,
  input: ApprovalCreationInput<K>,
): ApprovalHandle<K> => {
  const context = deriveApprovalRecordContext(input);

  const createParams: ApprovalCreateParams<K> = {
    approvalId: input.approvalId ?? globalThis.crypto.randomUUID(),
    kind: input.kind,
    origin: input.requester.origin,
    namespace: context.namespace,
    chainRef: context.chainRef,
    request: input.request,
    createdAt: input.createdAt ?? deps.now(),
  };

  return deps.approvals.create(createParams, input.requester);
};
