import { ArxBaseError } from "../error.js";

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
    super("Vault secret is not available.", {
      code: VaultLockedError.code,
    });
  }
}

export class VaultInvalidCiphertextError extends ArxBaseError {
  static readonly code = "vault.invalid_ciphertext";

  constructor(cause?: unknown) {
    super("Vault ciphertext is invalid or corrupted.", {
      code: VaultInvalidCiphertextError.code,
      ...(cause !== undefined ? { cause } : {}),
    });
  }
}

export class VaultInvalidPasswordError extends ArxBaseError {
  static readonly code = "vault.invalid_password";

  constructor() {
    super("Vault password is missing or incorrect.", {
      code: VaultInvalidPasswordError.code,
    });
  }
}

export class VaultPlatformUnavailableError extends ArxBaseError {
  static readonly code = "vault.platform_unavailable";

  constructor(platform: string) {
    super(`Vault platform API "${platform}" is not available.`, {
      code: VaultPlatformUnavailableError.code,
      details: { platform },
    });
  }
}

export class VaultInvariantViolationError extends ArxBaseError {
  static readonly code = "vault.invariant_violation";

  constructor(invariant: string) {
    super("Vault internal state is inconsistent.", {
      code: VaultInvariantViolationError.code,
      details: { invariant },
    });
  }
}

export class VaultConfigError extends ArxBaseError {
  static readonly code = "vault.config_invalid";

  constructor(field: "randomBytes" | "iterations" | "saltBytes" | "ivBytes") {
    super("Vault configuration is invalid.", {
      code: VaultConfigError.code,
      details: {
        field,
        reason: "positive_integer_required",
      },
    });
  }
}
