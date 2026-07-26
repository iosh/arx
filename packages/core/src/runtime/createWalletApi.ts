import type { Accounts } from "../accounts/Accounts.js";
import { AccountNotFoundError } from "../accounts/errors.js";
import type { Approvals } from "../approvals/Approvals.js";
import { generateBip39Mnemonic } from "../keyring/bip39.js";
import { HdKeyringNotFoundError, KeySourceNotFoundError } from "../keyring/errors.js";
import type { Keyring } from "../keyring/Keyring.js";
import type { Networks } from "../networks/Networks.js";
import type { CustomNetworkRemoval } from "../networks/removeCustomNetwork.js";
import type { DappAuthorization } from "../permissions/createDappAuthorization.js";
import type { Transactions } from "../transactions/Transactions.js";
import type { Vault } from "../vault/Vault.js";
import type { AutoLockController } from "../wallet/AutoLockController.js";
import type { WalletApi, WalletChainRpcApi } from "../wallet/WalletApi.js";
import type { WalletCoordinator } from "../wallet/WalletCoordinator.js";

type CreateWalletApiOptions = Readonly<{
  subscribe: WalletApi["subscribe"];
  vault: Pick<Vault, "getStatus">;
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

export const createWalletApi = (options: CreateWalletApiOptions): WalletApi => ({
  subscribe: options.subscribe,

  getStatus: async () => options.vault.getStatus(),
  createFromMnemonic: async (input) => options.coordinator.createFromMnemonic(input),
  restoreFromMnemonic: async (input) => options.coordinator.restoreFromMnemonic(input),
  createFromPrivateKey: async (input) => options.coordinator.createFromPrivateKey(input),
  unlock: async ({ password }) => options.coordinator.unlock(password),
  lock: async () => options.coordinator.lock(),
  changePassword: async (input) => options.coordinator.changePassword(input),
  getAutoLockDuration: async () => options.autoLock.getDuration(),
  setAutoLockDuration: async ({ durationMs }) => options.coordinator.setAutoLockDuration(durationMs),

  keySources: {
    generateMnemonic: async () => ({ mnemonic: generateBip39Mnemonic() }),
    get: async (keySourceId) => {
      const keySource = options.keyring.getKeySource(keySourceId);
      if (!keySource) throw new KeySourceNotFoundError(keySourceId);
      return keySource;
    },
    list: async () => options.keyring.listKeySources(),
    addMnemonic: async (input) => options.coordinator.addMnemonic(input),
    importMnemonic: async (input) => options.coordinator.importMnemonic(input),
    importPrivateKey: async (input) => options.coordinator.importPrivateKey(input),
    confirmMnemonicBackup: async (input) => options.coordinator.confirmMnemonicBackup(input),
    exportMnemonic: async (input) => options.coordinator.exportMnemonic(input),
    exportPrivateKey: async (input) => options.coordinator.exportPrivateKey(input),
    remove: async (input) => options.coordinator.removeKeySource(input),
  },

  hdKeyrings: {
    get: async (hdKeyringId) => {
      const hdKeyring = options.keyring.getHdKeyring(hdKeyringId);
      if (!hdKeyring) throw new HdKeyringNotFoundError(hdKeyringId);
      return hdKeyring;
    },
    list: async () => options.keyring.listHdKeyrings(),
    add: async (input) => options.coordinator.addHdKeyring(input),
    deriveAccount: async (input) => options.coordinator.deriveHdAccount(input),
    remove: async (input) => options.coordinator.removeHdKeyring(input),
  },

  accounts: {
    get: async (accountId) => {
      const account = options.accounts.getAccount(accountId);
      if (!account) throw new AccountNotFoundError(accountId);
      return account;
    },
    list: async () => options.accounts.listAccounts(),
    getAddress: async (input) => options.accounts.getAddress(input),
    listAddresses: async (chainRef) => options.accounts.listAddresses(chainRef),
    rename: async (input) => options.accounts.rename(input),
    setHidden: async (input) => options.coordinator.setAccountHidden(input),
    select: async ({ accountId }) => options.accounts.select(accountId),
  },

  networks: {
    get: async (chainRef) => options.networks.get(chainRef),
    list: async () => options.networks.list(),
    listByNamespace: async (namespace) => options.networks.listByNamespace(namespace),
    getSelection: async () => options.networks.getSelection(),
    getRpcConfiguration: async (chainRef) => options.networks.getRpcConfiguration(chainRef),
    addCustom: async (input) => options.networks.addCustom(input),
    updateCustom: async (input) => options.networks.updateCustom(input),
    removeCustom: async (chainRef) => options.customNetworkRemoval.removeCustom(chainRef),
    setRpcOverride: async (input) => options.networks.setRpcOverride(input),
    clearRpcOverride: async (chainRef) => options.networks.clearRpcOverride(chainRef),
    selectNetwork: async (chainRef) => options.networks.selectNetwork(chainRef),
    selectNamespace: async (namespace) => options.networks.selectNamespace(namespace),
  },

  chainRpc: options.chainRpc,

  permissions: {
    get: async (scope) => options.permissions.get(scope),
    list: async () => options.permissions.list(),
    listByOrigin: async (origin) => options.permissions.listByOrigin(origin),
    setAccounts: async (input) => options.permissions.setAccounts(input),
    revoke: async (scope) => options.permissions.revoke(scope),
    disconnectOrigin: async (input) => options.permissions.disconnectOrigin(input),
  },

  approvals: {
    get: async (approvalId) => options.approvals.get(approvalId),
    list: async () => options.approvals.list(),
    approve: async (decision) => options.approvals.approve(decision),
    reject: async (approvalId) => options.approvals.reject(approvalId),
  },

  transactions: {
    prepare: async (input) =>
      options.transactions.prepare({
        ...input,
        initiator: { type: "wallet" },
      }),
    submit: async (prepared) => (await options.transactions.submit(prepared)).transaction,
    prepareReplacement: async (input) => options.transactions.prepareReplacement(input),
    get: async (transactionId) => options.transactions.get(transactionId),
    list: async (query) => options.transactions.list(query),
  },
});
