import { ArxBaseError } from "../errors.js";

export class KeyringInvalidMnemonicError extends ArxBaseError {
  static readonly code = "keyring.invalid_mnemonic";

  constructor() {
    super("Mnemonic phrase is invalid.", {
      code: KeyringInvalidMnemonicError.code,
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

export class KeyringInvalidPrivateKeyError extends ArxBaseError {
  static readonly code = "keyring.invalid_private_key";

  constructor() {
    super("Private key must be a 32-byte hex value.", {
      code: KeyringInvalidPrivateKeyError.code,
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

export class KeyringUnsupportedNamespaceError extends ArxBaseError {
  static readonly code = "keyring.namespace_unsupported";

  constructor(namespace: string) {
    super(`Namespace "${namespace}" is not supported by keyring.`, {
      code: KeyringUnsupportedNamespaceError.code,
      details: { namespace },
    });
  }
}

export class KeyringUnsupportedDerivationProfileError extends ArxBaseError {
  static readonly code = "keyring.derivation_profile_unsupported";

  constructor(namespace: string, derivationProfileId: string) {
    super(`Derivation profile "${derivationProfileId}" is not supported by namespace "${namespace}".`, {
      code: KeyringUnsupportedDerivationProfileError.code,
      details: { namespace, derivationProfileId },
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
