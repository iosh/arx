import type { ControllerMessenger } from "../../messenger/ControllerMessenger.js";

export const ApprovalTypes = {
  RequestAccounts: "wallet_requestAccounts",
  SignMessage: "wallet_signMessage",
  SignTypedData: "wallet_signTypedData",
  SendTransaction: "wallet_sendTransaction",
  AddChain: "wallet_addEthereumChain",
} as const;

export type ApprovalType = (typeof ApprovalTypes)[keyof typeof ApprovalTypes];

export type ApprovalTask<T> = {
  id: string;
  type: ApprovalType;
  origin: string;
  payload: T;
};

export type ApprovalResult<T> = {
  id: string;
  value: T;
};

export type ApprovalState = {
  pending: string[];
};

export type ApprovalMessengerTopics = {
  "approval:stateChanged": ApprovalState;
  "approval:requested": ApprovalTask<unknown>;
  "approval:finished": ApprovalResult<unknown>;
};

export type ApprovalMessenger = ControllerMessenger<ApprovalMessengerTopics>;

export type ApprovalStrategy<TInput, TResult> = (task: ApprovalTask<TInput>) => Promise<TResult>;

export type ApprovalControllerOptions = {
  messenger: ApprovalMessenger;
  defaultStrategy?: ApprovalStrategy<unknown, unknown>;
  autoRejectMessage?: string;
  initialState?: ApprovalState;
};

export type ApprovalController = {
  getState(): ApprovalState;
  requestApproval<TInput, TResult>(
    task: ApprovalTask<TInput>,
    strategy?: ApprovalStrategy<TInput, TResult>,
  ): Promise<TResult>;
  onStateChanged(handler: (state: ApprovalState) => void): () => void;
  onRequest(handler: (task: ApprovalTask<unknown>) => void): () => void;
  onFinish(handler: (result: ApprovalResult<unknown>) => void): () => void;
  replaceState(state: ApprovalState): void;
};
