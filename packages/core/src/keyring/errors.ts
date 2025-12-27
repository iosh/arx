import { type ArxError, ArxReasons, arxError } from "@arx/errors";

export const keyringErrors = {
  notInitialized: (): ArxError =>
    arxError({ reason: ArxReasons.KeyringNotInitialized, message: "Keyring has not been initialized" }),
  invalidMnemonic: (): ArxError =>
    arxError({ reason: ArxReasons.KeyringInvalidMnemonic, message: "Mnemonic phrase is invalid" }),
  accountNotFound: (): ArxError =>
    arxError({
      reason: ArxReasons.KeyringAccountNotFound,
      message: "Requested account is not managed by this keyring",
    }),
  duplicateAccount: (): ArxError =>
    arxError({ reason: ArxReasons.KeyringDuplicateAccount, message: "Account already exists in this keyring" }),
  secretUnavailable: (): ArxError =>
    arxError({ reason: ArxReasons.KeyringSecretUnavailable, message: "Keyring secret is not available" }),
  indexOutOfRange: (): ArxError =>
    arxError({ reason: ArxReasons.KeyringIndexOutOfRange, message: "Derivation index is out of range" }),
  invalidPrivateKey: (): ArxError =>
    arxError({ reason: ArxReasons.KeyringInvalidPrivateKey, message: "Private key must be a 32-byte hex value" }),
  invalidAddress: (): ArxError =>
    arxError({ reason: ArxReasons.KeyringInvalidAddress, message: "Address is invalid or malformed" }),
};
