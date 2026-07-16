import { ArxBaseError } from "../errors.js";

export class PersistenceReadError extends ArxBaseError {
  static readonly code = "persistence.read_failed";

  constructor(cause: unknown) {
    super("Persistent data could not be read.", {
      code: PersistenceReadError.code,
      cause,
    });
  }
}

export class PersistenceCommitError extends ArxBaseError {
  static readonly code = "persistence.commit_failed";

  constructor(cause: unknown) {
    super("Persistent changes could not be committed.", {
      code: PersistenceCommitError.code,
      cause,
    });
  }
}
