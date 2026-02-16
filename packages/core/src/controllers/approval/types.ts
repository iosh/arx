import type { ChainRef } from "../../chains/ids.js";
import { ApprovalTypes } from "../../db/constants.js";
import type { FinalStatusReason, RequestContextRecord } from "../../db/records.js";
import type { ControllerMessenger } from "../../messenger/ControllerMessenger.js";
import type { ChainNamespace } from "../account/types.js";

export { ApprovalTypes };
export type ApprovalType = (typeof ApprovalTypes)[keyof typeof ApprovalTypes];

export type ApprovalQueueItem = {
  id: string;
  type: ApprovalType;
  origin: string;
  namespace?: ChainNamespace | undefined;
  chainRef?: ChainRef | undefined;
  createdAt: number;
};

export type ApprovalTask<T> = {
  id: string;
  type: ApprovalType;
  origin: string;
  namespace?: ChainNamespace | undefined;
  chainRef?: ChainRef | undefined;
  payload: T;
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
  task: ApprovalTask<unknown>;
  requestContext: RequestContextRecord;
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
export type PendingApproval<TInput = unknown> = {
  task: ApprovalTask<TInput>;
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
};

export type ApprovalController = {
  getState(): ApprovalState;
  requestApproval<TInput>(task: ApprovalTask<TInput>, requestContext: RequestContextRecord): Promise<unknown>;
  onStateChanged(handler: (state: ApprovalState) => void): () => void;
  onRequest(handler: (event: ApprovalRequestedEvent) => void): () => void;
  onFinish(handler: (event: ApprovalFinishedEvent<unknown>) => void): () => void;
  replaceState(state: ApprovalState): void;

  has(id: string): boolean;

  get(id: string): ApprovalTask<unknown> | undefined;

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
