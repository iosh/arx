import type { ChainRef } from "../../chains/ids.js";
import type { FinalStatusReason, RequestContextRecord } from "../../db/records.js";
import type { ControllerMessenger } from "../../messenger/ControllerMessenger.js";
import type { ChainNamespace } from "../account/types.js";

export const ApprovalTypes = {
  RequestAccounts: "wallet_requestAccounts",
  RequestPermissions: "wallet_requestPermissions",
  SignMessage: "wallet_signMessage",
  SignTypedData: "wallet_signTypedData",
  SendTransaction: "wallet_sendTransaction",
  AddChain: "wallet_addEthereumChain",
} as const;

export type ApprovalQueueItem = {
  id: string;
  type: ApprovalType;
  origin: string;
  namespace?: ChainNamespace | undefined;
  chainRef?: ChainRef | undefined;
  createdAt: number;
};

export type ApprovalType = (typeof ApprovalTypes)[keyof typeof ApprovalTypes];

export type ApprovalTask<T> = {
  id: string;
  type: ApprovalType;
  origin: string;
  namespace?: ChainNamespace | undefined;
  chainRef?: ChainRef | undefined;
  payload: T;
  createdAt: number;
};

export type ApprovalResult<T> = {
  id: string;
  namespace?: ChainNamespace | undefined;
  chainRef?: ChainRef | undefined;
  value: T;
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
  "approval:finished": ApprovalResult<unknown>;
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
  onFinish(handler: (result: ApprovalResult<unknown>) => void): () => void;
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
