import { ArxBaseError } from "../errors.js";

export class WalletAlreadyInitializedError extends ArxBaseError {
  static readonly code = "wallet.already_initialized";

  constructor() {
    super("Wallet is already initialized.", { code: WalletAlreadyInitializedError.code });
  }
}

export class WalletRecordNotFoundError extends ArxBaseError {
  static readonly code = "wallet.record_not_found";

  constructor(recordType: string, id: string) {
    super("Required wallet record was not found.", {
      code: WalletRecordNotFoundError.code,
      details: { recordType, id },
    });
  }
}

export class WalletOperationRejectedError extends ArxBaseError {
  static readonly code = "wallet.operation_rejected";

  constructor(reason: string) {
    super("Wallet operation was rejected.", {
      code: WalletOperationRejectedError.code,
      details: { reason },
    });
  }
}

export class WalletLockedError extends ArxBaseError {
  static readonly code = "wallet.locked";

  constructor() {
    super("Wallet is locked.", { code: WalletLockedError.code });
  }
}

export class WalletUnlockFailedError extends ArxBaseError {
  static readonly code = "wallet.unlock_failed";

  constructor(cause: unknown) {
    super("Wallet could not be unlocked.", {
      code: WalletUnlockFailedError.code,
      cause,
    });
  }
}
