import type { AccountId } from "../../accounts/accountId.js";
import { ArxBaseError } from "../../errors.js";

export class Eip155InvalidPrivateKeyError extends ArxBaseError {
  static readonly code = "eip155.invalid_private_key";

  constructor() {
    super("Private key must be a valid 32-byte secp256k1 secret.", {
      code: Eip155InvalidPrivateKeyError.code,
    });
  }
}

export class Eip155SigningAccountMismatchError extends ArxBaseError {
  static readonly code = "eip155.signing_account_mismatch";

  constructor(requestedAccountId: AccountId, actualAccountId: AccountId) {
    super("The signing key does not match the requested EIP-155 account.", {
      code: Eip155SigningAccountMismatchError.code,
      details: { requestedAccountId, actualAccountId },
    });
  }
}

export type Eip155InvalidChainIdReason = "negative" | "non_canonical" | "too_long";

export class Eip155InvalidChainIdError extends ArxBaseError {
  static readonly code = "eip155.invalid_chain_id";

  constructor(input: { value: string; reason: Eip155InvalidChainIdReason }) {
    super("Invalid EIP-155 chain ID.", {
      code: Eip155InvalidChainIdError.code,
      details: input,
    });
  }
}
