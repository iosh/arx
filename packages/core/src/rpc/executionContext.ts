import type { RequestContext } from "./requestContext.js";

export type RpcProviderRequestContext = RequestContext & {
  transport: "provider";
};

export type RpcProviderRequestCancellationReason = "caller_disconnected";

export type RpcBlockingApprovalReservation = {
  approvalId: string;
  createdAt: number;
};

type Awaitable<T> = T | Promise<T>;

export type RpcProviderRequestHandle = {
  id: string;
  namespace: string;
  signal: AbortSignal;
  attachBlockingApproval<T extends object>(
    createApproval: (reservation: RpcBlockingApprovalReservation) => Awaitable<T>,
    reservation?: Partial<RpcBlockingApprovalReservation>,
  ): Promise<T & RpcBlockingApprovalReservation>;
  fulfill(): boolean;
  reject(): boolean;
  cancel(reason: RpcProviderRequestCancellationReason): Promise<boolean>;
  getTerminalError(): Error | null;
};

export const RpcExecutionContextKinds = {
  None: "none",
  Provider: "provider",
} as const;

export type RpcNoExecutionContext = {
  kind: typeof RpcExecutionContextKinds.None;
};

export type RpcProviderExecutionContext = {
  kind: typeof RpcExecutionContextKinds.Provider;
  requestContext: RpcProviderRequestContext;
  providerRequestHandle: RpcProviderRequestHandle;
};

export type RpcExecutionContext = RpcNoExecutionContext | RpcProviderExecutionContext;

export const NO_RPC_EXECUTION_CONTEXT: RpcExecutionContext = { kind: RpcExecutionContextKinds.None };
