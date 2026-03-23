import type {
  ConfirmNewMnemonicParams,
  ImportMnemonicParams,
  ImportPrivateKeyParams,
  KeyringService,
} from "../../runtime/keyring/KeyringService.js";

export type UiConfirmNewMnemonicParams = ConfirmNewMnemonicParams;
export type UiImportMnemonicParams = ImportMnemonicParams;
export type UiImportPrivateKeyParams = ImportPrivateKeyParams;

export type UiKeyringsAccess = Pick<
  KeyringService,
  | "deriveAccount"
  | "exportMnemonic"
  | "exportPrivateKeyByAccountKey"
  | "generateMnemonic"
  | "getAccountsByKeyring"
  | "getKeyrings"
  | "hideHdAccount"
  | "markBackedUp"
  | "removePrivateKeyKeyring"
  | "renameAccount"
  | "renameKeyring"
  | "unhideHdAccount"
> & {
  confirmNewMnemonic: (params: UiConfirmNewMnemonicParams) => ReturnType<KeyringService["confirmNewMnemonic"]>;
  importMnemonic: (params: UiImportMnemonicParams) => ReturnType<KeyringService["importMnemonic"]>;
  importPrivateKey: (params: UiImportPrivateKeyParams) => ReturnType<KeyringService["importPrivateKey"]>;
};

export type CreateUiKeyringsAccessDeps = {
  keyring: KeyringService;
};

export const createUiKeyringsAccess = ({ keyring }: CreateUiKeyringsAccessDeps): UiKeyringsAccess => ({
  confirmNewMnemonic: (params) => keyring.confirmNewMnemonic(params),
  deriveAccount: (keyringId) => keyring.deriveAccount(keyringId),
  exportMnemonic: (keyringId, password) => keyring.exportMnemonic(keyringId, password),
  exportPrivateKeyByAccountKey: (accountKey, password) => keyring.exportPrivateKeyByAccountKey(accountKey, password),
  generateMnemonic: (wordCount) => keyring.generateMnemonic(wordCount),
  getAccountsByKeyring: (keyringId, includeHidden) => keyring.getAccountsByKeyring(keyringId, includeHidden),
  getKeyrings: () => keyring.getKeyrings(),
  hideHdAccount: (accountKey) => keyring.hideHdAccount(accountKey),
  importMnemonic: (params) => keyring.importMnemonic(params),
  importPrivateKey: (params) => keyring.importPrivateKey(params),
  markBackedUp: (keyringId) => keyring.markBackedUp(keyringId),
  removePrivateKeyKeyring: (keyringId) => keyring.removePrivateKeyKeyring(keyringId),
  renameAccount: (accountKey, alias) => keyring.renameAccount(accountKey, alias),
  renameKeyring: (keyringId, alias) => keyring.renameKeyring(keyringId, alias),
  unhideHdAccount: (accountKey) => keyring.unhideHdAccount(accountKey),
});
