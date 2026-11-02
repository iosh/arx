import { ArxBaseError } from "../errors.js";
import type { Namespace } from "../namespaces/types.js";

export class KeyringLockedError extends ArxBaseError {
  static readonly code = "keyring.locked";

  constructor() {
    super("Software key material is not unlocked.", { code: KeyringLockedError.code });
  }
}

export class KeyringNotInitializedError extends ArxBaseError {
  static readonly code = "keyring.not_initialized";

  constructor() {
    super("Software key storage has not been initialized.", { code: KeyringNotInitializedError.code });
  }
}

export class KeyringInvalidPrivateKeyError extends ArxBaseError {
  static readonly code = "keyring.invalid_private_key";

  constructor(namespace: Namespace) {
    super(`Private key is invalid for namespace "${namespace}".`, {
      code: KeyringInvalidPrivateKeyError.code,
      details: { namespace },
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

export class KeySourceNotFoundError extends ArxBaseError {
  static readonly code = "keyring.key_source_not_found";

  constructor(keySourceId: string) {
    super(`Key source "${keySourceId}" was not found.`, {
      code: KeySourceNotFoundError.code,
      details: { keySourceId },
    });
  }
}

export class HdKeyringNotFoundError extends ArxBaseError {
  static readonly code = "keyring.hd_keyring_not_found";

  constructor(hdKeyringId: string) {
    super(`HD keyring "${hdKeyringId}" was not found.`, {
      code: HdKeyringNotFoundError.code,
      details: { hdKeyringId },
    });
  }
}

export class KeySourceTypeMismatchError extends ArxBaseError {
  static readonly code = "keyring.key_source_type_mismatch";

  constructor(input: {
    keySourceId: string;
    expectedType: "bip39" | "private-key";
    actualType: "bip39" | "private-key";
  }) {
    super(`Key source "${input.keySourceId}" is not a ${input.expectedType} source.`, {
      code: KeySourceTypeMismatchError.code,
      details: input,
    });
  }
}

export class KeySourceBackupUnsupportedError extends ArxBaseError {
  static readonly code = "keyring.key_source_backup_unsupported";

  constructor(keySourceId: string) {
    super("Backup confirmation only applies to BIP39 key sources.", {
      code: KeySourceBackupUnsupportedError.code,
      details: { keySourceId },
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
