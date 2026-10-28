import type { Accounts } from "../accounts/Accounts.js";
import type { AccountId } from "../accounts/accountId.js";
import { AccountNotFoundError } from "../accounts/errors.js";
import type { Approvals } from "../approvals/Approvals.js";
import { generateBip39Mnemonic } from "../keyring/bip39.js";
import { HdKeyringNotFoundError, KeyringInvalidPrivateKeyError, KeySourceNotFoundError } from "../keyring/errors.js";
import type { Keyring } from "../keyring/Keyring.js";
import { parseChainRef } from "../networks/chainRef.js";
import type { Networks } from "../networks/Networks.js";
import type { CustomNetworkRemoval } from "../networks/removeCustomNetwork.js";
import type { DappAuthorization } from "../permissions/createDappAuthorization.js";
import type { Transactions } from "../transactions/Transactions.js";
import type { AutoLockController } from "../wallet/AutoLockController.js";
import type { WalletApi, WalletChainRpcApi } from "../wallet/WalletApi.js";
import type { WalletCoordinator } from "../wallet/WalletCoordinator.js";

type CreateWalletApiOptions = Readonly<{
  subscribe: WalletApi["subscribe"];
  autoLock: Pick<AutoLockController, "getDuration">;
  coordinator: WalletCoordinator;
  keyring: Keyring;
  accounts: Accounts;
  networks: Networks;
  customNetworkRemoval: CustomNetworkRemoval;
  chainRpc: WalletChainRpcApi;
  permissions: DappAuthorization["permissions"];
  approvals: Pick<Approvals, "get" | "list" | "approve" | "reject">;
  transactions: Transactions;
}>;

export const createWalletApi = ({
  subscribe,
  autoLock,
  coordinator,
  keyring,
  accounts,
  networks,
  customNetworkRemoval,
  chainRpc,
  permissions,
  approvals,
  transactions,
}: CreateWalletApiOptions): WalletApi => ({
  subscribe,

  getStatus: async () => coordinator.getStatus(),
  createFromMnemonic: async (input) => coordinator.createFromMnemonic(input),
  restoreFromMnemonic: async (input) => coordinator.restoreFromMnemonic(input),
  createFromPrivateKey: async (input) => coordinator.createFromPrivateKey(input),
  unlock: async ({ password }) => coordinator.unlock(password),
  lock: async () => coordinator.lock(),
  changePassword: async (input) => coordinator.changePassword(input),
  getAutoLockDuration: async () => autoLock.getDuration(),
  setAutoLockDuration: async ({ durationMs }) => coordinator.setAutoLockDuration(durationMs),
  notifyUserActivity: async () => coordinator.notifyUserActivity(),

  keySources: {
    generateMnemonic: async () => ({ mnemonic: generateBip39Mnemonic() }),
    get: async (keySourceId) => {
      const keySource = keyring.getKeySource(keySourceId);
      if (!keySource) throw new KeySourceNotFoundError(keySourceId);
      return keySource;
    },
    list: async () => keyring.listKeySources(),
    addMnemonic: async (input) => coordinator.addMnemonic(input),
    addMnemonicAndMoveAccount: async (input) => coordinator.addMnemonicAndMoveAccount(input),
    importPrivateKey: async (input) => coordinator.importPrivateKey(input),
    renameMnemonic: async (input) => keyring.renameMnemonicSource(input),
    confirmMnemonicBackup: async (input) => keyring.confirmMnemonicBackup(input),
    exportMnemonic: async (input) => coordinator.exportMnemonic(input),
    exportPrivateKey: async (input) => coordinator.exportPrivateKey(input),
    remove: async (input) => coordinator.removeKeySource(input),
  },

  hdKeyrings: {
    get: async (hdKeyringId) => {
      const hdKeyring = keyring.getHdKeyring(hdKeyringId);
      if (!hdKeyring) throw new HdKeyringNotFoundError(hdKeyringId);
      return hdKeyring;
    },
    list: async () => keyring.listHdKeyrings(),
    add: async (input) => coordinator.addHdKeyring(input),
    remove: async (input) => coordinator.removeHdKeyring(input),
  },

  accounts: {
    get: async (accountId) => {
      const account = accounts.getAccount(accountId);
      if (!account) throw new AccountNotFoundError(accountId);
      return account;
    },
    getSelected: async () => {
      const { selectedNamespace } = networks.getSelection();
      return accounts.getSelectedAccount(selectedNamespace);
    },
    list: async () => accounts.listAccounts(),
    getAddresses: async (input) => accounts.getAddresses(input),
    fromPrivateKey: async ({ privateKey, chainRef }) => {
      const { namespace } = parseChainRef(chainRef);
      let accountId: AccountId;
      try {
        accountId = keyring.accountIdFromPrivateKey({ privateKey, namespace });
      } catch (error) {
        if (error instanceof KeyringInvalidPrivateKeyError) return null;
        throw error;
      }
      return { accountId, namespace, addresses: accounts.getAddresses({ accountId, chainRef }) };
    },
    create: async (input) => coordinator.createHdAccount(input),
    move: async (input) => coordinator.movePrivateKeyAccount(input),
    rename: async (input) => accounts.rename(input),
    setHidden: async (input) => coordinator.setAccountHidden(input),
    select: async ({ accountId }) => accounts.select(accountId),
  },

  networks: {
    get: async (chainRef) => networks.get(chainRef),
    list: async () => networks.list(),
    listByNamespace: async (namespace) => networks.listByNamespace(namespace),
    getSelection: async () => networks.getSelection(),
    getRpcConfiguration: async (chainRef) => networks.getRpcConfiguration(chainRef),
    addCustom: async (input) => networks.addCustom(input),
    updateCustom: async (input) => networks.updateCustom(input),
    removeCustom: async (chainRef) => customNetworkRemoval.removeCustom(chainRef),
    setRpcOverride: async (input) => networks.setRpcOverride(input),
    clearRpcOverride: async (chainRef) => networks.clearRpcOverride(chainRef),
    selectNetwork: async (chainRef) => networks.selectNetwork(chainRef),
    selectNamespace: async (namespace) => networks.selectNamespace(namespace),
  },

  chainRpc,

  permissions: {
    get: async (scope) => permissions.get(scope),
    list: async () => permissions.list(),
    listByOrigin: async (origin) => permissions.listByOrigin(origin),
    setAccounts: async (input) => permissions.setAccounts(input),
    revoke: async (scope) => permissions.revoke(scope),
    disconnectOrigin: async (input) => permissions.disconnectOrigin(input),
  },

  approvals: {
    get: async (approvalId) => approvals.get(approvalId),
    list: async () => approvals.list(),
    approve: async (decision) => approvals.approve(decision),
    reject: async (approvalId) => approvals.reject(approvalId),
  },

  transactions: {
    prepare: async (input) =>
      transactions.prepare({
        ...input,
        initiator: { type: "wallet" },
      }),
    submit: async (prepared) => (await transactions.submit(prepared)).transaction,
    prepareReplacement: async (input) => transactions.prepareReplacement(input),
    get: async (transactionId) => transactions.get(transactionId),
    list: async (query) => transactions.list(query),
  },
});
