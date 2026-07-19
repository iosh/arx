import { ArxBaseError } from "../errors.js";

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

export class KeyringDuplicateSourceError extends ArxBaseError {
  static readonly code = "keyring.source_duplicate";

  constructor(existingKeySourceId: string) {
    super("A matching key source already exists.", {
      code: KeyringDuplicateSourceError.code,
      details: { existingKeySourceId },
    });
  }
}

export class HdKeyringAlreadyExistsError extends ArxBaseError {
  static readonly code = "keyring.hd_keyring_already_exists";

  constructor(params: {
    existingHdKeyringId: string;
    keySourceId: string;
    namespace: string;
  }) {
    super("An HD keyring already exists for this source and namespace.", {
      code: HdKeyringAlreadyExistsError.code,
      details: params,
    });
  }
}

export class HdKeyringRequiresBip39SourceError extends ArxBaseError {
  static readonly code = "keyring.hd_keyring_requires_bip39_source";

  constructor(keySourceId: string) {
    super("An HD keyring requires a BIP39 key source.", {
      code: HdKeyringRequiresBip39SourceError.code,
      details: { keySourceId },
    });
  }
}

export class KeySourceRequiresHdKeyringError extends ArxBaseError {
  static readonly code = "keyring.key_source_requires_hd_keyring";

  constructor(keySourceId: string) {
    super("A BIP39 key source must retain at least one HD keyring.", {
      code: KeySourceRequiresHdKeyringError.code,
      details: { keySourceId },
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
