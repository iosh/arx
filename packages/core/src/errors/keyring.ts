export type KeyringErrorCode =
  | "ARX_KEYRING_NOT_INITIALIZED"
  | "ARX_KEYRING_INVALID_MNEMONIC"
  | "ARX_KEYRING_ACCOUNT_NOT_FOUND"
  | "ARX_KEYRING_DUPLICATE_ACCOUNT"
  | "ARX_KEYRING_SECRET_UNAVAILABLE"
  | "ARX_KEYRING_INDEX_OUT_OF_RANGE"
  | "ARX_KEYRING_INVALID_PRIVATE_KEY"
  | "ARX_KEYRING_INVALID_ADDRESS";

type KeyringError = Error & { code: KeyringErrorCode };

const createKeyringError = (message: string, code: KeyringErrorCode): KeyringError => {
  const error = new Error(message) as KeyringError;
  error.name = "KeyringError";
  error.code = code;
  return error;
};

export const keyringErrors = {
  notInitialized: (): KeyringError =>
    createKeyringError("Keyring has not been initialized", "ARX_KEYRING_NOT_INITIALIZED"),
  invalidMnemonic: (): KeyringError => createKeyringError("Mnemonic phrase is invalid", "ARX_KEYRING_INVALID_MNEMONIC"),
  accountNotFound: (): KeyringError =>
    createKeyringError("Requested account is not managed by this keyring", "ARX_KEYRING_ACCOUNT_NOT_FOUND"),
  duplicateAccount: (): KeyringError =>
    createKeyringError("Account already exists in this keyring", "ARX_KEYRING_DUPLICATE_ACCOUNT"),
  secretUnavailable: (): KeyringError =>
    createKeyringError("Keyring secret is not available", "ARX_KEYRING_SECRET_UNAVAILABLE"),
  indexOutOfRange: (): KeyringError =>
    createKeyringError("Derivation index is out of range", "ARX_KEYRING_INDEX_OUT_OF_RANGE"),
  invalidPrivateKey: (): KeyringError =>
    createKeyringError("Private key must be a 32-byte hex value", "ARX_KEYRING_INVALID_PRIVATE_KEY"),
  invalidAddress: (): KeyringError =>
    createKeyringError("Address is invalid or malformed", "ARX_KEYRING_INVALID_ADDRESS"),
};
