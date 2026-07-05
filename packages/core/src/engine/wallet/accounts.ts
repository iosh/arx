import type { AccountSelectionService } from "../../accounts/runtime/types.js";
import type { KeyringService } from "../../runtime/keyring/KeyringService.js";
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
    return sum + (namespaceState?.accountIds.length ?? 0);
  }, 0);

  return {
    totalAccountCount,
    hasOwnedAccounts: totalAccountCount > 0,
  };
};

export const createWalletAccounts = (deps: {
  accounts: AccountSelectionService;
  keyring: KeyringService;
}): WalletAccounts => {
  const { accounts, keyring } = deps;
  const waitForAccountReadModel = async () => {
    await accounts.whenReady?.();
  };

  return {
    getState: () => accounts.getState(),
    listOwnedForNamespace: (params) => accounts.listOwnedForNamespace(params),
    getOwnedAccount: (params) => accounts.getOwnedAccount(params),
    getAccountIdsForNamespace: (namespace) => accounts.getAccountIdsForNamespace(namespace),
    getSelectedAccountId: (namespace) => accounts.getSelectedAccountId(namespace),
    getActiveAccountForNamespace: (params) => accounts.getActiveAccountForNamespace(params),
    setActiveAccount: (params) => accounts.setActiveAccount(params),
    generateMnemonic: (wordCount) => keyring.generateMnemonic(wordCount),
    confirmNewMnemonic: async (params) => {
      const created = await keyring.confirmNewMnemonic(params);
      await waitForAccountReadModel();
      return created;
    },
    importMnemonic: async (params) => {
      const imported = await keyring.importMnemonic(params);
      await waitForAccountReadModel();
      return imported;
    },
    importPrivateKey: async (params) => {
      const imported = await keyring.importPrivateKey(params);
      await waitForAccountReadModel();
      return imported;
    },
    deriveAccount: async (keyringId) => {
      const derived = await keyring.deriveAccount(keyringId);
      await waitForAccountReadModel();
      return derived;
    },
    exportMnemonic: (keyringId, password) => keyring.exportMnemonic(keyringId, password),
    exportPrivateKeyByAccountId: (accountId, password) => keyring.exportPrivateKeyByAccountId(accountId, password),
    hideHdAccount: async (accountId) => {
      await keyring.hideHdAccount(accountId);
      await waitForAccountReadModel();
    },
    unhideHdAccount: async (accountId) => {
      await keyring.unhideHdAccount(accountId);
      await waitForAccountReadModel();
    },
    renameKeyring: (keyringId, alias) => keyring.renameKeyring(keyringId, alias),
    renameAccount: (accountId, alias) => keyring.renameAccount(accountId, alias),
    markBackedUp: (keyringId) => keyring.markBackedUp(keyringId),
    removePrivateKeyKeyring: async (keyringId) => {
      await keyring.removePrivateKeyKeyring(keyringId);
      await waitForAccountReadModel();
    },
    getKeyrings: () => keyring.getKeyrings(),
    getAccountsByKeyring: (keyringId, includeHidden) => keyring.getAccountsByKeyring(keyringId, includeHidden),
    getBackupStatus: () => deriveBackupStatus(keyring),
    getWalletSetupState: () => deriveWalletSetupState(accounts),
  };
};
