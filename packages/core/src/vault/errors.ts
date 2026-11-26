import { ArxBaseError } from "../errors.js";

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
