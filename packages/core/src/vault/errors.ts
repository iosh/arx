import { ArxBaseError } from "../errors.js";

export class VaultNotInitializedError extends ArxBaseError {
  static readonly code = "vault.not_initialized";

  constructor() {
    super("Vault has not been initialized.", {
      code: VaultNotInitializedError.code,
    });
  }
}

export class VaultLockedError extends ArxBaseError {
  static readonly code = "vault.locked";

  constructor() {
    super("Vault is locked.", {
      code: VaultLockedError.code,
    });
  }
}

export class VaultIncorrectPasswordError extends ArxBaseError {
  static readonly code = "vault.incorrect_password";

  constructor() {
    super("Vault password is incorrect.", {
      code: VaultIncorrectPasswordError.code,
    });
  }
}

export class VaultPasswordTooShortError extends ArxBaseError {
  static readonly code = "vault.password_too_short";

  constructor(minimumLength: number, actualLength: number) {
    super(`Vault password must contain at least ${minimumLength} characters.`, {
      code: VaultPasswordTooShortError.code,
      details: { minimumLength, actualLength },
    });
  }
}

export class VaultRecordDecodeError extends ArxBaseError {
  static readonly code = "vault.record_decode_failed";

  constructor(cause: unknown) {
    super("Stored vault record could not be decoded.", {
      code: VaultRecordDecodeError.code,
      cause,
    });
  }
}

export type VaultCryptoOperation = "random-bytes" | "derive-encryption-key" | "encrypt";

export class VaultCryptoOperationError extends ArxBaseError {
  static readonly code = "vault.crypto_operation_failed";

  constructor(operation: VaultCryptoOperation, cause: unknown) {
    super("Vault cryptographic operation failed.", {
      code: VaultCryptoOperationError.code,
      details: { operation },
      cause,
    });
  }
}
