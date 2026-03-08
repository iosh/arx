import type { ChainRef } from "../../chains/ids.js";
import type { ChainMetadata } from "../../chains/metadata.js";
import type { ChainNamespace } from "../../controllers/account/types.js";
import type { RequestContext } from "../../rpc/requestContext.js";
import type { PermissionApprovalResult, RequestPermissionsApprovalPayload } from "../permission/types.js";
import type { TransactionApprovalTaskPayload, TransactionMeta } from "../transaction/types.js";
import { type ApprovalKind, ApprovalKinds, type ApprovalType, ApprovalTypes } from "./constants.js";

export { ApprovalKinds, ApprovalTypes };
export type { ApprovalKind, ApprovalType };
export { getApprovalKind, getApprovalType } from "./constants.js";

export type ApprovalTerminalReason =
  | "user_approve"
  | "user_reject"
  | "timeout"
  | "locked"
  | "session_lost"
  | "window_closed"
  | "replaced"
  | "internal_error";

export type ApprovalFinalStatus = "approved" | "rejected" | "cancelled" | "expired" | "failed";

export type ApprovalScope = Pick<RequestContext, "transport" | "origin" | "portId" | "sessionId">;

export type ApprovalRequester = ApprovalScope & Pick<RequestContext, "requestId">;

export type ApprovalQueueItem = {
  id: string;
  kind: ApprovalKind;
  origin: string;
  namespace?: ChainNamespace | undefined;
  chainRef?: ChainRef | undefined;
  createdAt: number;
};

export type ApprovalRequestByKind = {
  [ApprovalKinds.RequestAccounts]: {
    chainRef?: ChainRef | undefined;
    suggestedAccounts?: string[] | undefined;
  };
  [ApprovalKinds.RequestPermissions]: RequestPermissionsApprovalPayload;
  [ApprovalKinds.SignMessage]: {
    chainRef?: ChainRef | undefined;
    from: string;
    message: string;
  };
  [ApprovalKinds.SignTypedData]: {
    chainRef?: ChainRef | undefined;
    from: string;
    typedData: string;
  };
  [ApprovalKinds.SendTransaction]: TransactionApprovalTaskPayload;
  [ApprovalKinds.SwitchChain]: { chainRef: ChainRef };
  [ApprovalKinds.AddChain]: { metadata: ChainMetadata; isUpdate: boolean };
};

export type ApprovalDecisionByKind = {
  [ApprovalKinds.RequestAccounts]: undefined;
  [ApprovalKinds.RequestPermissions]: undefined;
  [ApprovalKinds.SignMessage]: undefined;
  [ApprovalKinds.SignTypedData]: undefined;
  [ApprovalKinds.SendTransaction]: undefined;
  [ApprovalKinds.SwitchChain]: undefined;
  [ApprovalKinds.AddChain]: undefined;
};

export type ApprovalResultByKind = {
  [ApprovalKinds.RequestAccounts]: string[];
  [ApprovalKinds.RequestPermissions]: PermissionApprovalResult;
  [ApprovalKinds.SignMessage]: string;
  [ApprovalKinds.SignTypedData]: string;
  [ApprovalKinds.SendTransaction]: TransactionMeta;
  [ApprovalKinds.SwitchChain]: null;
  [ApprovalKinds.AddChain]: null;
};

export type ApprovalRequest<K extends ApprovalKind = ApprovalKind> = ApprovalRequestByKind[K];

export type ApprovalDecision<K extends ApprovalKind = ApprovalKind> = ApprovalDecisionByKind[K];

export type ApprovalResult<K extends ApprovalKind = ApprovalKind> = ApprovalResultByKind[K];

export type ApprovalCreateParams<K extends ApprovalKind = ApprovalKind> = {
  id: string;
  kind: K;
  origin: string;
  namespace?: ChainNamespace | undefined;
  chainRef?: ChainRef | undefined;
  request: ApprovalRequest<K>;
  createdAt: number;
};

export type ApprovalRecord<K extends ApprovalKind = ApprovalKind> = ApprovalCreateParams<K> & {
  requester: ApprovalRequester;
};

export type ApprovalHandle<K extends ApprovalKind = ApprovalKind> = {
  id: string;
  settled: Promise<ApprovalResult<K>>;
};

export type ApprovalCreatedEvent = {
  record: ApprovalRecord;
};

export type ApprovalFinishedEvent<T = unknown> = {
  id: string;
  status: ApprovalFinalStatus;
  terminalReason: ApprovalTerminalReason;

  kind?: ApprovalKind | undefined;
  origin?: string | undefined;
  namespace?: ChainNamespace | undefined;
  chainRef?: ChainRef | undefined;

  value?: T | undefined;
  error?: { name: string; message: string } | undefined;
};

export type ApprovalState = {
  pending: ApprovalQueueItem[];
};

export type ApprovalResolveInput =
  | {
      id: string;
      action: "approve";
      decision?: unknown;
    }
  | {
      id: string;
      action: "reject";
      reason?: string;
      error?: Error;
    };

export type ApprovalResolveResult<T = unknown> = {
  id: string;
  status: ApprovalFinalStatus;
  value?: T | undefined;
};

export type PendingApproval<K extends ApprovalKind = ApprovalKind> = {
  record: ApprovalRecord<K>;
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
};

export type ApprovalController = {
  getState(): ApprovalState;
  get(id: string): ApprovalRecord | undefined;
  create<K extends ApprovalKind>(request: ApprovalCreateParams<K>, requester: ApprovalRequester): ApprovalHandle<K>;
  onStateChanged(handler: (state: ApprovalState) => void): () => void;
  onCreated(handler: (event: ApprovalCreatedEvent) => void): () => void;
  onFinished(handler: (event: ApprovalFinishedEvent<unknown>) => void): () => void;

  has(id: string): boolean;

  resolve(input: ApprovalResolveInput): Promise<ApprovalResolveResult>;

  cancel(input: { id: string; reason: ApprovalTerminalReason; error?: Error }): Promise<void>;

  cancelByScope(input: { scope: ApprovalScope; reason: ApprovalTerminalReason }): Promise<number>;
};
