import type { AccountId } from "../accounts/accountId.js";
import { ArxBaseError } from "../errors.js";

export class WalletAccountMoveConflictError extends ArxBaseError {
  static readonly code = "wallet.account_move_conflict";

  constructor(accountId: AccountId) {
    super("The account's current state does not match the requested move.", {
      code: WalletAccountMoveConflictError.code,
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
