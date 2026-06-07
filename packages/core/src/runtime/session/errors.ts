import { ArxBaseError, type ErrorCause } from "../../error.js";

export class SessionLockedError extends ArxBaseError {
  static readonly code = "global.session.locked";

  constructor(input: ErrorCause = {}) {
    super("Wallet session is locked.", {
      code: SessionLockedError.code,
      cause: input.cause,
    });
  }
}
