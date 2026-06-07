import { ArxBaseError, type ErrorCause } from "../error.js";

export class KeyringNotInitializedError extends ArxBaseError {
  static readonly code = "keyring.not_initialized";

  constructor(input: ErrorCause = {}) {
    super("Keyring has not been initialized.", {
      code: KeyringNotInitializedError.code,
      cause: input.cause,
    });
  }
}

export class KeyringInvalidMnemonicError extends ArxBaseError {
  static readonly code = "keyring.invalid_mnemonic";

  constructor(input: ErrorCause = {}) {
    super("Mnemonic phrase is invalid.", {
      code: KeyringInvalidMnemonicError.code,
      cause: input.cause,
    });
  }
}

export class KeyringAccountNotFoundError extends ArxBaseError {
  static readonly code = "keyring.account_not_found";

  constructor(input: ErrorCause = {}) {
    super("Requested account is not managed by this keyring.", {
      code: KeyringAccountNotFoundError.code,
      cause: input.cause,
    });
  }
}

export class KeyringDuplicateAccountError extends ArxBaseError {
  static readonly code = "keyring.duplicate_account";

  constructor(input: ErrorCause = {}) {
    super("Account already exists in this keyring.", {
      code: KeyringDuplicateAccountError.code,
      cause: input.cause,
    });
  }
}

export class KeyringSecretUnavailableError extends ArxBaseError {
  static readonly code = "keyring.secret_unavailable";

  constructor(input: ErrorCause = {}) {
    super("Keyring secret is not available.", {
      code: KeyringSecretUnavailableError.code,
      cause: input.cause,
    });
  }
}

export class KeyringIndexOutOfRangeError extends ArxBaseError {
  static readonly code = "keyring.index_out_of_range";

  constructor(input: ErrorCause = {}) {
    super("Derivation index is out of range.", {
      code: KeyringIndexOutOfRangeError.code,
      cause: input.cause,
    });
  }
}

export class KeyringInvalidPrivateKeyError extends ArxBaseError {
  static readonly code = "keyring.invalid_private_key";

  constructor(input: ErrorCause = {}) {
    super("Private key must be a 32-byte hex value.", {
      code: KeyringInvalidPrivateKeyError.code,
      cause: input.cause,
    });
  }
}

export class KeyringInvalidAddressError extends ArxBaseError {
  static readonly code = "keyring.invalid_address";

  constructor(input: ErrorCause = {}) {
    super("Address is invalid or malformed.", {
      code: KeyringInvalidAddressError.code,
      cause: input.cause,
    });
  }
}
