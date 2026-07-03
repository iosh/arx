import { ArxBaseError, type ErrorCause } from "../error.js";
import type { AccountId } from "../storage/records.js";

export class AccountNotOwnedError extends ArxBaseError {
  static readonly code = "account.not_owned";

  constructor(input: ErrorCause & { accountId: AccountId; chainRef: string; namespace: string }) {
    super("Requested account is not owned by this wallet.", {
      code: AccountNotOwnedError.code,
      details: {
        accountId: input.accountId,
        chainRef: input.chainRef,
        namespace: input.namespace,
      },
      cause: input.cause,
    });
  }
}
