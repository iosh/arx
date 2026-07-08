import type { ChainNamespace } from "../../accounts/runtime/types.js";
import type { ChainDefinition, RpcEndpoint } from "../../chains/definition.js";
import type { ChainRef } from "../../chains/ids.js";
import type { RequestPermissionsApprovalPayload } from "../../permissions/service/types.js";
import type { AccountId } from "../../storage/records.js";
import type { TransactionReadyProposal } from "../../transactions/TransactionsService.js";
import type { ApprovalSource } from "../source.js";
import { type ApprovalKind, ApprovalKinds, type ApprovalType, ApprovalTypes } from "./constants.js";

export { getApprovalKind, getApprovalType } from "./constants.js";
export type { ApprovalKind, ApprovalType };
export { ApprovalKinds, ApprovalTypes };

export type ApprovalTerminalReason =
  | "user_approve"
  | "user_reject"
  | "timeout"
  | "locked"
  | "caller_disconnected"
  | "user_dismissed"
  | "superseded"
  | "runtime_shutdown"
  | "internal_error";

export type ApprovalFinalStatus = "approved" | "rejected" | "cancelled" | "expired" | "failed";

export type ApprovalRequester = {
  origin: string;
  source: ApprovalSource;
  requestId?: string | undefined;
};

export type ApprovalScope =
  | {
      transport: "provider";
      origin: string;
      portId: string;
      sessionId: string;
    }
  | {
      transport: "wallet-ui";
      origin: string;
    };

export type ApprovalQueueItem = {
  approvalId: string;
  kind: ApprovalKind;
  source: ApprovalSource;
  scope: ApprovalScope;
  origin: string;
  namespace: ChainNamespace;
  chainRef: ChainRef;
  createdAt: number;
};

export type ApprovalRequestByKind = {
  [ApprovalKinds.RequestAccounts]: {
    chainRef: ChainRef;
    suggestedAccounts?: string[] | undefined;
  };
  [ApprovalKinds.RequestPermissions]: RequestPermissionsApprovalPayload;
  [ApprovalKinds.SignMessage]: {
    chainRef: ChainRef;
    from: string;
    message: string;
  };
  [ApprovalKinds.SignTypedData]: {
    chainRef: ChainRef;
    from: string;
    typedData: string;
  };
  [ApprovalKinds.SwitchChain]: { chainRef: ChainRef };
  [ApprovalKinds.AddChain]: {
    definition: ChainDefinition;
    defaultRpcEndpoints: readonly RpcEndpoint[];
    isUpdate: boolean;
  };
  [ApprovalKinds.SendTransaction]: {
    proposal: TransactionReadyProposal;
  };
};

export type ApprovalAccountSelectionDecision = {
  accountIds: [AccountId, ...AccountId[]];
};

export type ApprovalRequest<K extends ApprovalKind = ApprovalKind> = ApprovalRequestByKind[K];

export type ApprovalDecision = unknown;

export type ApprovalCreateParams<K extends ApprovalKind = ApprovalKind> = {
  approvalId: string;
  kind: K;
  origin: string;
  namespace: ChainNamespace;
  chainRef: ChainRef;
  scope: ApprovalScope;
  request: ApprovalRequest<K>;
  createdAt: number;
};

export type ApprovalRecord<K extends ApprovalKind = ApprovalKind> = ApprovalCreateParams<K> & {
  requester: ApprovalRequester;
};

export type ApprovalHandle = {
  approvalId: string;
  settled: Promise<ApprovalDecision>;
};

export type ApprovalCreatedEvent = {
  record: ApprovalRecord;
};

export type ApprovalFinishedErrorSummary = {
  name: string;
  message: string;
  code?: string | undefined;
};

export type ApprovalFinishedEvent = {
  approvalId: string;
  status: ApprovalFinalStatus;
  terminalReason: ApprovalTerminalReason;

  kind?: ApprovalKind | undefined;
  origin?: string | undefined;
  namespace?: ChainNamespace | undefined;
  chainRef?: ChainRef | undefined;

  error?: ApprovalFinishedErrorSummary | undefined;
};

export type ApprovalState = {
  pending: ApprovalQueueItem[];
};

export type ApprovalResolveInput =
  | {
      approvalId: string;
      action: "approve";
      decision?: unknown;
    }
  | {
      approvalId: string;
      action: "reject";
      reason?: string | undefined;
      error?: Error | undefined;
    };

export type ApprovalResolveResult =
  | {
      approvalId: string;
      status: "approved";
      terminalReason: "user_approve";
      decision: ApprovalDecision;
    }
  | {
      approvalId: string;
      status: "rejected";
      terminalReason: "user_reject";
    };

export type ApprovalQueueService = {
  getState(): ApprovalState;
  get(approvalId: string): ApprovalRecord | undefined;
  listPending(): ApprovalRecord[];
  create<K extends ApprovalKind>(request: ApprovalCreateParams<K>, requester: ApprovalRequester): ApprovalHandle;
  onStateChanged(handler: (state: ApprovalState) => void): () => void;
  onCreated(handler: (event: ApprovalCreatedEvent) => void): () => void;
  onFinished(handler: (event: ApprovalFinishedEvent) => void): () => void;

  has(approvalId: string): boolean;

  resolve(input: ApprovalResolveInput): Promise<ApprovalResolveResult>;

  cancel(input: { approvalId: string; reason: ApprovalTerminalReason; error?: Error }): void;
  cancelScope(scope: ApprovalScope, reason: ApprovalTerminalReason): number;
};
