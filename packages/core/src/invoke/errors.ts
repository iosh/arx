import { ArxBaseError } from "../errors.js";

export type InvokeTransportErrorReason =
  | "connect-failed"
  | "disconnected"
  | "invalid-message"
  | "post-message-failed"
  | "request-timeout";

export class InvokeTransportError extends ArxBaseError {
  static readonly code = "invoke.transport";

  constructor(input: {
    target: string;
    action: string;
    requestId: string;
    reason: InvokeTransportErrorReason;
    cause?: unknown;
  }) {
    super(`Invoke transport error for "${input.target}.${input.action}": ${input.reason}`, {
      code: InvokeTransportError.code,
      details: {
        target: input.target,
        action: input.action,
        requestId: input.requestId,
        reason: input.reason,
      },
      cause: input.cause,
    });
  }
}

export class InvokeProtocolError extends ArxBaseError {
  static readonly code = "invoke.protocol";

  constructor(input: {
    target: string;
    action: string;
    requestId: string;
    reason: string;
    cause?: unknown;
  }) {
    super(`Invoke protocol error for "${input.target}.${input.action}": ${input.reason}`, {
      code: InvokeProtocolError.code,
      details: {
        target: input.target,
        action: input.action,
        requestId: input.requestId,
        reason: input.reason,
      },
      cause: input.cause,
    });
  }
}

export class InvokeConnectInvalidatedError extends ArxBaseError {
  static readonly code = "invoke.connect_invalidated";

  constructor(cause?: unknown) {
    super("Invoke connection was invalidated before it became ready.", {
      code: InvokeConnectInvalidatedError.code,
      cause,
    });
  }
}
