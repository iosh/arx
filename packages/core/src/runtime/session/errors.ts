import { ArxBaseError, type ErrorCause } from "../../error.js";

type SessionLockInvariantInput = ErrorCause & {
  invariant: string;
};

export class SessionLockedError extends ArxBaseError {
  static readonly code = "global.session.locked";

  constructor(input: ErrorCause = {}) {
    super("Wallet session is locked.", {
      code: SessionLockedError.code,
      cause: input.cause,
    });
  }
}

export class SessionLockInvariantError extends ArxBaseError {
  static readonly code = "global.session.lock_invariant";

  constructor(input: SessionLockInvariantInput) {
    super("Session lock state is inconsistent.", {
      code: SessionLockInvariantError.code,
      details: { invariant: input.invariant },
      cause: input.cause,
    });
  }
}
