import type { UiContext, UiError, UiPortEnvelope } from "../messages.js";
import type { UiEventName, UiEventPayload, UiMethodName, UiMethodParams, UiMethodResult } from "../protocol.js";
import type { UiSnapshot } from "../schemas.js";

export type UiTransport = {
  connect: () => Promise<void>;
  disconnect?: () => void;

  postMessage: (message: UiPortEnvelope) => void;

  onMessage: (listener: (message: unknown) => void) => () => void;
  onDisconnect?: (listener: (error?: unknown) => void) => () => void;

  isConnected?: () => boolean;
};

export type UiClientOptions = {
  requestTimeoutMs?: number;
  createRequestId?: () => string;
  logger?: Pick<Console, "warn" | "error" | "debug">;
};

export class UiProtocolError extends Error {
  name = "UiProtocolError" as const;
}

export class UiRemoteError extends Error {
  name = "UiRemoteError" as const;

  reason?: UiError["reason"];
  data?: unknown;
  context?: UiContext | undefined;

  constructor(payload: UiError, context?: UiContext) {
    super(payload.message);
    this.reason = payload.reason;
    this.data = payload.data;
    this.context = context;
  }
}

export type UiClient = {
  connect: () => Promise<void>;

  call: <M extends UiMethodName>(
    method: M,
    params?: UiMethodParams<M>,
    opts?: { signal?: AbortSignal },
  ) => Promise<UiMethodResult<M>>;

  on: <E extends UiEventName>(event: E, listener: (payload: UiEventPayload<E>) => void) => () => void;

  getLastSnapshot: () => UiSnapshot | null;
  waitForSnapshot: (opts?: { timeoutMs?: number; predicate?: (s: UiSnapshot) => boolean }) => Promise<UiSnapshot>;

  destroy: () => void;

  extend: <E extends Record<string, unknown>>(
    this: UiClient & Record<string, unknown>,
    extension: (client: UiClient) => E,
  ) => UiClient & E;
};

export type PendingRequest = {
  method: UiMethodName;
  resolve: (value: unknown) => void;
  reject: (reason: Error) => void;
  timeout: ReturnType<typeof setTimeout>;
  abortUnsubscribe?: () => void;
};
