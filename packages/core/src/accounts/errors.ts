import { ArxBaseError, type ErrorCause } from "../error.js";
import type { AccountKey } from "../storage/records.js";

export class AccountNotOwnedError extends ArxBaseError {
  static readonly code = "account.not_owned";

  constructor(input: ErrorCause & { accountKey: AccountKey; chainRef: string; namespace: string }) {
    super("Requested account is not owned by this wallet.", {
      code: AccountNotOwnedError.code,
      details: {
        accountKey: input.accountKey,
        chainRef: input.chainRef,
        namespace: input.namespace,
      },
      cause: input.cause,
    });
  }
}
