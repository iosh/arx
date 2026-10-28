import type { AccountId } from "../accounts/accountId.js";
import { ArxBaseError } from "../errors.js";

export class WalletAccountKeyMismatchError extends ArxBaseError {
  static readonly code = "wallet.account_key_mismatch";

  constructor(accountId: AccountId) {
    super("The stored key material does not match the account identity.", {
      code: WalletAccountKeyMismatchError.code,
      details: { accountId },
    });
  }
}

export class WalletLastKeySourceRemovalError extends ArxBaseError {
  static readonly code = "wallet.last_key_source_removal";

  constructor() {
    super("The last key source cannot be removed.", {
      code: WalletLastKeySourceRemovalError.code,
    });
  }
}

export class WalletLockedError extends ArxBaseError {
  static readonly code = "wallet.locked";

  constructor() {
    super("Wallet is locked.", { code: WalletLockedError.code });
  }
}

export class AutoLockDurationOutOfRangeError extends ArxBaseError {
  static readonly code = "wallet.auto_lock_duration_out_of_range";

  constructor(durationMs: number) {
    super("Auto-lock duration is outside the supported range.", {
      code: AutoLockDurationOutOfRangeError.code,
      details: { durationMs },
    });
  }
}
