import { ArxBaseError } from "../errors.js";

export class WalletAlreadyInitializedError extends ArxBaseError {
  static readonly code = "wallet.already_initialized";

  constructor() {
    super("Wallet is already initialized.", { code: WalletAlreadyInitializedError.code });
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

export class AutoLockDurationOutOfRangeError extends ArxBaseError {
  static readonly code = "wallet.auto_lock_duration_out_of_range";

  constructor(durationMs: number) {
    super("Auto-lock duration is outside the supported range.", {
      code: AutoLockDurationOutOfRangeError.code,
      details: { durationMs },
    });
  }
}
