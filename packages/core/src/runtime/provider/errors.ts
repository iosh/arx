import { ArxBaseError, type ErrorCause } from "../../error.js";

export type TransportDisconnectedInput = ErrorCause & {
  message?: string;
};

export class TransportDisconnectedError extends ArxBaseError {
  static readonly code = "global.transport.disconnected";

  constructor(input: TransportDisconnectedInput = {}) {
    super(input.message ?? "Transport disconnected.", {
      code: TransportDisconnectedError.code,
      cause: input.cause,
    });
  }
}
