import { ArxBaseError } from "../errors.js";
import type { Namespace } from "../namespaces/types.js";

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
