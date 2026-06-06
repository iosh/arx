import { parseChainRef } from "../chains/caip.js";
import {
  type ApprovalController,
  type ApprovalCreateParams,
  type ApprovalHandle,
  ApprovalKinds,
  type ApprovalRequest,
  type ApprovalRequester,
  type ControllerApprovalKind,
} from "../controllers/approval/types.js";

export type ApprovalCreationDeps = {
  approvals: Pick<ApprovalController, "create">;
  now: () => number;
};

export type ApprovalCreationInput<K extends ControllerApprovalKind = ControllerApprovalKind> = {
  kind: K;
  request: ApprovalRequest<K>;
  requester: ApprovalRequester;
  approvalId?: string;
  createdAt?: number;
};

const deriveApprovalRecordContext = <K extends ControllerApprovalKind>(input: ApprovalCreationInput<K>) => {
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

export const requestApproval = <K extends ControllerApprovalKind>(
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
