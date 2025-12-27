import { type ArxError, ArxReasons, arxError } from "@arx/errors";

export const vaultErrors = {
  notInitialized: (): ArxError =>
    arxError({ reason: ArxReasons.VaultNotInitialized, message: "Vault has not been initialized" }),
  locked: (): ArxError => arxError({ reason: ArxReasons.VaultLocked, message: "Vault is locked" }),
  invalidCiphertext: (cause?: unknown): ArxError =>
    arxError({
      reason: ArxReasons.VaultInvalidCiphertext,
      message: "Vault ciphertext is invalid or corrupted",
      cause,
    }),
  invalidPassword: (): ArxError =>
    arxError({ reason: ArxReasons.VaultInvalidPassword, message: "Vault password is missing or incorrect" }),
};
