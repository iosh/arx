import { ArxBaseError } from "../error.js";

export class SessionLockedError extends ArxBaseError {
  static readonly code = "global.session.locked";

  constructor() {
    super("Wallet session is locked.", {
      code: SessionLockedError.code,
    });
  }
}

export class SessionLockInvariantError extends ArxBaseError {
  static readonly code = "global.session.lock_invariant";

  constructor(invariant: string) {
    super("Session lock state is inconsistent.", {
      code: SessionLockInvariantError.code,
      details: { invariant },
    });
  }
}

export class SessionVaultMutationUnlockedError extends ArxBaseError {
  static readonly code = "global.session.vault_mutation_unlocked";

  constructor(operation: "initialize" | "loadEnvelope") {
    super("Vault mutation left the vault unlocked.", {
      code: SessionVaultMutationUnlockedError.code,
      details: { operation },
    });
  }
}

export class SessionImportEnvelopeMissingError extends ArxBaseError {
  static readonly code = "global.session.import_envelope_missing";

  constructor() {
    super("Session vault import completed without an envelope.", {
      code: SessionImportEnvelopeMissingError.code,
    });
  }
}

export class SessionAutoLockDurationInvalidError extends ArxBaseError {
  static readonly code = "global.session.config_invalid";

  constructor() {
    super("Auto-lock duration must be a positive number.", {
      code: SessionAutoLockDurationInvalidError.code,
      details: {
        field: "autoLockDurationMs",
        reason: "positive_number_required",
      },
    });
  }
}

export class SessionHydrationError extends ArxBaseError {
  static readonly code = "global.session.hydration_failed";

  constructor(resource: "vaultMeta" | "vaultEnvelope", cause: unknown) {
    super("Failed to hydrate session state.", {
      code: SessionHydrationError.code,
      details: { resource },
      cause,
    });
  }
}
