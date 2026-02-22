import { ApprovalTypes } from "../../approvals/constants.js";
import type { ChainRef } from "../../chains/ids.js";
import type { ChainMetadata } from "../../chains/metadata.js";
import type { ControllerMessenger } from "../../messenger/ControllerMessenger.js";
import type { RequestContext } from "../../rpc/requestContext.js";
import type { ChainNamespace } from "../account/types.js";
import type { PermissionApprovalResult, RequestPermissionsApprovalPayload } from "../permission/types.js";
import type { TransactionApprovalTaskPayload, TransactionMeta } from "../transaction/types.js";

export { ApprovalTypes };
export type ApprovalType = (typeof ApprovalTypes)[keyof typeof ApprovalTypes];

/**
 * Reason for a terminal approval state.
 *
 * Notes:
 * - This is no longer tied to persistence (approvals are in-memory).
 * - Keep the union reasonably stable for UI/logging and future evolution.
 */
export type FinalStatusReason =
  | "timeout"
  | "session_lost"
  | "locked"
  | "user_reject"
  | "user_approve"
  | "replaced"
  | "internal_error";

export type ApprovalQueueItem = {
  id: string;
  type: ApprovalType;
  origin: string;
  namespace?: ChainNamespace | undefined;
  chainRef?: ChainRef | undefined;
  createdAt: number;
};

export type ApprovalPayloadByType = {
  [ApprovalTypes.RequestAccounts]: {
    chainRef?: ChainRef | undefined;
    suggestedAccounts?: string[] | undefined;
  };
  [ApprovalTypes.RequestPermissions]: RequestPermissionsApprovalPayload;
  [ApprovalTypes.SignMessage]: {
    chainRef?: ChainRef | undefined;
    from: string;
    message: string;
  };
  [ApprovalTypes.SignTypedData]: {
    chainRef?: ChainRef | undefined;
    from: string;
    typedData: string;
  };
  [ApprovalTypes.SendTransaction]: TransactionApprovalTaskPayload;
  [ApprovalTypes.SwitchChain]: { chainRef: ChainRef };
  [ApprovalTypes.AddChain]: { metadata: ChainMetadata; isUpdate: boolean };
};

export type ApprovalResultByType = {
  [ApprovalTypes.RequestAccounts]: string[];
  [ApprovalTypes.RequestPermissions]: PermissionApprovalResult;
  [ApprovalTypes.SignMessage]: string;
  [ApprovalTypes.SignTypedData]: string;
  [ApprovalTypes.SendTransaction]: TransactionMeta;
  [ApprovalTypes.SwitchChain]: null;
  [ApprovalTypes.AddChain]: null;
};

export type ApprovalTask<K extends ApprovalType = ApprovalType> = {
  id: string;
  type: K;
  origin: string;
  namespace?: ChainNamespace | undefined;
  chainRef?: ChainRef | undefined;
  payload: ApprovalPayloadByType[K];
  createdAt: number;
};

export type ApprovalFinishedEvent<T = unknown> = {
  id: string;
  status: "approved" | "rejected" | "expired";
  finalStatusReason: FinalStatusReason;

  type?: ApprovalType | undefined;
  origin?: string | undefined;
  namespace?: ChainNamespace | undefined;
  chainRef?: ChainRef | undefined;

  value?: T | undefined;

  error?: { name: string; message: string } | undefined;
};

export type ApprovalState = {
  pending: ApprovalQueueItem[];
};

export type ApprovalRequestedEvent = {
  task: ApprovalTask;
  requestContext: RequestContext;
};

export type ApprovalMessengerTopics = {
  "approval:stateChanged": ApprovalState;
  "approval:requested": ApprovalRequestedEvent;
  "approval:finished": ApprovalFinishedEvent<unknown>;
};

export type ApprovalMessenger = ControllerMessenger<ApprovalMessengerTopics>;

export type ApprovalExecutor<TResult> = () => Promise<TResult>;

/**
 * Internal structure for tracking pending approvals with their resolvers.
 */
export type PendingApproval<K extends ApprovalType = ApprovalType> = {
  task: ApprovalTask<K>;
  requestContext: RequestContext;
  // We cannot reliably type this by id alone (resolve() takes only id),
  // and the generic K is not recoverable from the id at runtime.
  // Keep the resolver value loosely typed and enforce typing at the
  // requestApproval() callsite boundary instead.
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
};

export type ApprovalController = {
  getState(): ApprovalState;
  requestApproval<K extends ApprovalType>(
    task: ApprovalTask<K>,
    requestContext: RequestContext,
  ): Promise<ApprovalResultByType[K]>;
  onStateChanged(handler: (state: ApprovalState) => void): () => void;
  onRequest(handler: (event: ApprovalRequestedEvent) => void): () => void;
  onFinish(handler: (event: ApprovalFinishedEvent<unknown>) => void): () => void;

  has(id: string): boolean;

  get(id: string): ApprovalTask | undefined;

  resolve<TResult>(id: string, executor: ApprovalExecutor<TResult>): Promise<TResult>;

  reject(id: string, reason?: Error): void;

  /**
   * Best-effort cleanup for session-bound approvals when the backing transport is lost.
   * Implementations should finalize matching pending approvals as expired(session_lost)
   * and reject any in-memory resolvers.
   */
  expirePendingByRequestContext(params: {
    portId: string;
    sessionId: string;
    finalStatusReason?: FinalStatusReason;
  }): Promise<number>;
};
