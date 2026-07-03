import type { AccountSelectionService } from "../../accounts/runtime/types.js";
import type { KeyringService } from "../../runtime/keyring/KeyringService.js";
import type { KeyringExportService } from "../../services/runtime/keyringExport.js";
import type { WalletAccounts, WalletBackupStatus, WalletSetupState } from "../types.js";

const deriveBackupStatus = (keyrings: Pick<KeyringService, "getKeyrings">): WalletBackupStatus => {
  const pendingHdKeyrings = keyrings
    .getKeyrings()
    .filter((meta) => meta.type === "hd" && meta.needsBackup === true)
    .sort((left, right) => left.createdAt - right.createdAt || left.id.localeCompare(right.id));

  const nextHdKeyring = pendingHdKeyrings[0] ?? null;

  return {
    pendingHdKeyringCount: pendingHdKeyrings.length,
    nextHdKeyring: nextHdKeyring
      ? {
          keyringId: nextHdKeyring.id,
          alias: nextHdKeyring.alias ?? null,
        }
      : null,
  };
};

const deriveWalletSetupState = (accounts: Pick<AccountSelectionService, "getState">): WalletSetupState => {
  const state = accounts.getState();
  const totalAccountCount = Object.values(state.namespaces).reduce((sum, namespaceState) => {
    return sum + namespaceState.accountIds.length;
  }, 0);

  return {
    totalAccountCount,
    hasOwnedAccounts: totalAccountCount > 0,
  };
};

export const createWalletAccounts = (deps: {
  accounts: AccountSelectionService;
  keyring: KeyringService;
  keyringExport: KeyringExportService;
}): WalletAccounts => {
  const { accounts, keyring, keyringExport } = deps;

  return {
    getState: () => accounts.getState(),
    listOwnedForNamespace: (params) => accounts.listOwnedForNamespace(params),
    getOwnedAccount: (params) => accounts.getOwnedAccount(params),
    getAccountIdsForNamespace: (namespace) => accounts.getAccountIdsForNamespace(namespace),
    getSelectedAccountId: (namespace) => accounts.getSelectedAccountId(namespace),
    getActiveAccountForNamespace: (params) => accounts.getActiveAccountForNamespace(params),
    setActiveAccount: (params) => accounts.setActiveAccount(params),
    generateMnemonic: (wordCount) => keyring.generateMnemonic(wordCount),
    confirmNewMnemonic: (params) => keyring.confirmNewMnemonic(params),
    importMnemonic: (params) => keyring.importMnemonic(params),
    importPrivateKey: (params) => keyring.importPrivateKey(params),
    deriveAccount: (keyringId) => keyring.deriveAccount(keyringId),
    exportMnemonic: (keyringId, password) => keyringExport.exportMnemonic(keyringId, password),
    exportPrivateKeyByAccountId: (accountId, password) =>
      keyringExport.exportPrivateKeyByAccountId(accountId, password),
    hideHdAccount: (accountId) => keyring.hideHdAccount(accountId),
    unhideHdAccount: (accountId) => keyring.unhideHdAccount(accountId),
    renameKeyring: (keyringId, alias) => keyring.renameKeyring(keyringId, alias),
    renameAccount: (accountId, alias) => keyring.renameAccount(accountId, alias),
    markBackedUp: (keyringId) => keyring.markBackedUp(keyringId),
    removePrivateKeyKeyring: (keyringId) => keyring.removePrivateKeyKeyring(keyringId),
    getKeyrings: () => keyring.getKeyrings(),
    getAccountsByKeyring: (keyringId, includeHidden) => keyring.getAccountsByKeyring(keyringId, includeHidden),
    getBackupStatus: () => deriveBackupStatus(keyring),
    getWalletSetupState: () => deriveWalletSetupState(accounts),
  };
};
