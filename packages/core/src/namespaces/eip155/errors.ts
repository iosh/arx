import type { AccountId } from "../../accounts/accountId.js";
import { ArxBaseError } from "../../errors.js";

export class Eip155SigningAccountMismatchError extends ArxBaseError {
  static readonly code = "eip155.signing_account_mismatch";

  constructor(requestedAccountId: AccountId, actualAccountId: AccountId) {
    super("The signing key does not match the requested EIP-155 account.", {
      code: Eip155SigningAccountMismatchError.code,
      details: { requestedAccountId, actualAccountId },
    });
  }
}
