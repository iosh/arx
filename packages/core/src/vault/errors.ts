import { ArxBaseError, type ErrorCause } from "../error.js";

type VaultInvariantViolationInput = ErrorCause & {
  invariant: string;
};

export class VaultNotInitializedError extends ArxBaseError {
  static readonly code = "vault.not_initialized";

  constructor(input: ErrorCause = {}) {
    super("Vault has not been initialized.", {
      code: VaultNotInitializedError.code,
      cause: input.cause,
    });
  }
}

export class VaultLockedError extends ArxBaseError {
  static readonly code = "vault.locked";

  constructor(input: ErrorCause = {}) {
    super("Vault secret is not available.", {
      code: VaultLockedError.code,
      cause: input.cause,
    });
  }
}

export class VaultInvalidCiphertextError extends ArxBaseError {
  static readonly code = "vault.invalid_ciphertext";

  constructor(input: ErrorCause = {}) {
    super("Vault ciphertext is invalid or corrupted.", {
      code: VaultInvalidCiphertextError.code,
      cause: input.cause,
    });
  }
}

export class VaultInvalidPasswordError extends ArxBaseError {
  static readonly code = "vault.invalid_password";

  constructor(input: ErrorCause = {}) {
    super("Vault password is missing or incorrect.", {
      code: VaultInvalidPasswordError.code,
      cause: input.cause,
    });
  }
}

export class VaultPlatformUnavailableError extends ArxBaseError {
  static readonly code = "vault.platform_unavailable";

  constructor(input: ErrorCause & { platform: string }) {
    super(`Vault platform API "${input.platform}" is not available.`, {
      code: VaultPlatformUnavailableError.code,
      details: { platform: input.platform },
      cause: input.cause,
    });
  }
}

export class VaultInvariantViolationError extends ArxBaseError {
  static readonly code = "vault.invariant_violation";

  constructor(input: VaultInvariantViolationInput) {
    super("Vault internal state is inconsistent.", {
      code: VaultInvariantViolationError.code,
      details: { invariant: input.invariant },
      cause: input.cause,
    });
  }
}
