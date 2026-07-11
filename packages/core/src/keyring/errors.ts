import { ArxBaseError } from "../error.js";

export class KeyringNotInitializedError extends ArxBaseError {
  static readonly code = "keyring.not_initialized";

  constructor() {
    super("Keyring has not been initialized.", {
      code: KeyringNotInitializedError.code,
    });
  }
}

export class KeyringInvalidMnemonicError extends ArxBaseError {
  static readonly code = "keyring.invalid_mnemonic";

  constructor() {
    super("Mnemonic phrase is invalid.", {
      code: KeyringInvalidMnemonicError.code,
    });
  }
}

export class KeyringAccountNotFoundError extends ArxBaseError {
  static readonly code = "keyring.account_not_found";

  constructor() {
    super("Requested account is not managed by this keyring.", {
      code: KeyringAccountNotFoundError.code,
    });
  }
}

export class KeyringDuplicateAccountError extends ArxBaseError {
  static readonly code = "keyring.duplicate_account";

  constructor() {
    super("Account already exists in this keyring.", {
      code: KeyringDuplicateAccountError.code,
    });
  }
}

export class KeyringSecretUnavailableError extends ArxBaseError {
  static readonly code = "keyring.secret_unavailable";

  constructor() {
    super("Keyring secret is not available.", {
      code: KeyringSecretUnavailableError.code,
    });
  }
}

export class KeyringIndexOutOfRangeError extends ArxBaseError {
  static readonly code = "keyring.index_out_of_range";

  constructor() {
    super("Derivation index is out of range.", {
      code: KeyringIndexOutOfRangeError.code,
    });
  }
}

export class KeyringInvalidPrivateKeyError extends ArxBaseError {
  static readonly code = "keyring.invalid_private_key";

  constructor() {
    super("Private key must be a 32-byte hex value.", {
      code: KeyringInvalidPrivateKeyError.code,
    });
  }
}

export type KeyringInvalidVaultPayloadDetails = {
  path: string;
  reason: string;
};

export class KeyringInvalidVaultPayloadError extends ArxBaseError {
  static readonly code = "keyring.invalid_vault_payload";

  constructor(details?: KeyringInvalidVaultPayloadDetails) {
    super("Keyring vault payload is invalid.", {
      code: KeyringInvalidVaultPayloadError.code,
      ...(details ? { details } : {}),
    });
  }
}

export class KeyringInvalidAddressError extends ArxBaseError {
  static readonly code = "keyring.invalid_address";

  constructor() {
    super("Address is invalid or malformed.", {
      code: KeyringInvalidAddressError.code,
    });
  }
}

export class KeyringNamespaceConfigRequiredError extends ArxBaseError {
  static readonly code = "keyring.namespace_config_required";

  constructor() {
    super("At least one keyring namespace must be configured.", {
      code: KeyringNamespaceConfigRequiredError.code,
    });
  }
}

export class KeyringUnsupportedNamespaceError extends ArxBaseError {
  static readonly code = "keyring.namespace_unsupported";

  constructor(namespace: string) {
    super(`Namespace "${namespace}" is not supported by keyring.`, {
      code: KeyringUnsupportedNamespaceError.code,
      details: { namespace },
    });
  }
}

export class KeyringUnsupportedKindError extends ArxBaseError {
  static readonly code = "keyring.kind_unsupported";

  constructor(namespace: string, keyringKind: string) {
    super(`Namespace "${namespace}" does not support ${keyringKind} keyring.`, {
      code: KeyringUnsupportedKindError.code,
      details: { namespace, keyringKind },
    });
  }
}

export class KeyringNotFoundError extends ArxBaseError {
  static readonly code = "keyring.not_found";

  constructor(keyringId: string) {
    super(`Keyring "${keyringId}" was not found.`, {
      code: KeyringNotFoundError.code,
      details: { keyringId },
    });
  }
}

export class KeyringSourceNotFoundError extends ArxBaseError {
  static readonly code = "keyring.source_not_found";

  constructor(keySourceId: string) {
    super("Key source required by the unlocked keyring was not found.", {
      code: KeyringSourceNotFoundError.code,
      details: { keySourceId },
    });
  }
}

export class KeyringAccountEntryMissingError extends ArxBaseError {
  static readonly code = "keyring.account_entry_missing";

  constructor(address: string) {
    super(`Account entry missing for address ${address}.`, {
      code: KeyringAccountEntryMissingError.code,
      details: { address },
    });
  }
}

export class KeyringMetadataMissingError extends ArxBaseError {
  static readonly code = "keyring.metadata_missing";

  constructor(keyringId: string) {
    super(`Keyring metadata missing for "${keyringId}".`, {
      code: KeyringMetadataMissingError.code,
      details: { keyringId },
    });
  }
}

export class KeyringPrivateKeyEntryMissingError extends ArxBaseError {
  static readonly code = "keyring.private_key_entry_missing";

  constructor() {
    super("Private key entry is missing after import.", {
      code: KeyringPrivateKeyEntryMissingError.code,
    });
  }
}

export class KeyringHydrationTimeoutError extends ArxBaseError {
  static readonly code = "keyring.hydration_timeout";

  constructor() {
    super("Timed out while hydrating keyring state.", {
      code: KeyringHydrationTimeoutError.code,
    });
  }
}

export class KeyringHydrationMetadataMissingError extends ArxBaseError {
  static readonly code = "keyring.hydration_metadata_missing";

  constructor(keyringId: string, keyringKind: string) {
    super("Hydrated keyring metadata is missing.", {
      code: KeyringHydrationMetadataMissingError.code,
      details: { keyringId, keyringKind },
    });
  }
}

export class KeyringHydrationAccountMismatchError extends ArxBaseError {
  static readonly code = "keyring.hydration_account_mismatch";

  constructor(input: { keyringId: string; accountId: string; namespace: string; keyringKind: string }) {
    super("Persisted keyring account does not match unlocked key material.", {
      code: KeyringHydrationAccountMismatchError.code,
      details: input,
    });
  }
}

export class KeyringPrivateKeyAccountCountError extends ArxBaseError {
  static readonly code = "keyring.private_key_account_count_invalid";

  constructor(input: { keyringId: string; namespace: string; actualCount: number }) {
    super("Private-key keyring must have exactly one persisted account.", {
      code: KeyringPrivateKeyAccountCountError.code,
      details: {
        keyringId: input.keyringId,
        namespace: input.namespace,
        expectedCount: 1,
        actualCount: input.actualCount,
      },
    });
  }
}

export class KeyringHydrationAccountMissingError extends ArxBaseError {
  static readonly code = "keyring.hydration_account_missing";

  constructor(input: { keyringId: string; namespace: string; keyringKind: string }) {
    super("Hydrated keyring account is missing.", {
      code: KeyringHydrationAccountMissingError.code,
      details: input,
    });
  }
}

export class KeyringInvalidSigningPayloadError extends ArxBaseError {
  static readonly code = "keyring.signing_payload_invalid";

  constructor(actualBytes: number) {
    super("Signing payload must be a 32-byte digest.", {
      code: KeyringInvalidSigningPayloadError.code,
      details: {
        field: "digest",
        expectedBytes: 32,
        actualBytes,
      },
    });
  }
}
