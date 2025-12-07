import type { Caip2ChainId } from "../../chains/ids.js";
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
  chainRef?: Caip2ChainId | undefined;
  createdAt: number;
};

export type ApprovalType = (typeof ApprovalTypes)[keyof typeof ApprovalTypes];

export type ApprovalTask<T> = {
  id: string;
  type: ApprovalType;
  origin: string;
  namespace?: ChainNamespace | undefined;
  chainRef?: Caip2ChainId | undefined;
  payload: T;
  createdAt: number;
};

export type ApprovalResult<T> = {
  id: string;
  namespace?: ChainNamespace | undefined;
  chainRef?: Caip2ChainId | undefined;
  value: T;
};

export type ApprovalState = {
  pending: ApprovalQueueItem[];
};

export type ApprovalMessengerTopics = {
  "approval:stateChanged": ApprovalState;
  "approval:requested": ApprovalTask<unknown>;
  "approval:finished": ApprovalResult<unknown>;
};

export type ApprovalMessenger = ControllerMessenger<ApprovalMessengerTopics>;

export type ApprovalControllerOptions = {
  messenger: ApprovalMessenger;
  autoRejectMessage?: string;
  initialState?: ApprovalState;
};

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
  requestApproval<TInput>(task: ApprovalTask<TInput>): Promise<unknown>;
  onStateChanged(handler: (state: ApprovalState) => void): () => void;
  onRequest(handler: (task: ApprovalTask<unknown>) => void): () => void;
  onFinish(handler: (result: ApprovalResult<unknown>) => void): () => void;
  replaceState(state: ApprovalState): void;

  has(id: string): boolean;

  get(id: string): ApprovalTask<unknown> | undefined;

  resolve<TResult>(id: string, executor: ApprovalExecutor<TResult>): Promise<TResult>;

  reject(id: string, reason?: Error): void;
};
