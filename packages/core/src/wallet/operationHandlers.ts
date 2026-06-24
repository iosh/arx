import { listAccountsForCurrentChain, switchActiveAccount } from "./actions/accounts.js";
import { getApprovalDetail, listPendingApprovals, resolveApproval } from "./actions/approvals.js";
import { getNativeBalance } from "./actions/balances.js";
import { getSelectedWalletChain, listWalletNetworks, selectWalletChain } from "./actions/chains.js";
import {
  confirmNewMnemonic,
  deriveAccount,
  exportMnemonic,
  exportPrivateKey,
  getAccountsByKeyring,
  getBackupStatus,
  hideHdAccount,
  importMnemonic,
  importPrivateKey,
  listKeyrings,
  markBackedUp,
  removePrivateKeyKeyring,
  renameAccount,
  renameKeyring,
  unhideHdAccount,
} from "./actions/keyrings.js";
import {
  getSessionStatus,
  lockSession,
  resetAutoLockTimer,
  setAutoLockDuration,
  unlockSession,
} from "./actions/session.js";
import {
  createWalletFromMnemonic,
  generateMnemonic,
  getWalletSetupStatus,
  importWalletFromMnemonic,
  importWalletFromPrivateKey,
} from "./actions/setup.js";
import {
  applyTransactionDraftEdit,
  getTransactionDetail,
  listTransactionHistory,
  requestSendTransactionApproval,
  rerunTransactionPrepare,
} from "./actions/transactions.js";
import type { TrustedWalletApi } from "./api.js";
import type { WalletApiContext } from "./context.js";
import type { WalletMethodHandlerTree } from "./executor.js";

export const walletMethodHandlers = {
  session: {
    getStatus: getSessionStatus,
    unlock: unlockSession,
    lock: lockSession,
    resetAutoLockTimer,
    setAutoLockDuration,
  },
  setup: {
    getStatus: getWalletSetupStatus,
    generateMnemonic,
    createWalletFromMnemonic,
    importWalletFromMnemonic,
    importWalletFromPrivateKey,
  },
  accounts: {
    listCurrentChain: listAccountsForCurrentChain,
    switchActive: switchActiveAccount,
  },
  networks: {
    getSelectedChain: getSelectedWalletChain,
    list: listWalletNetworks,
    select: selectWalletChain,
  },
  balances: {
    getNative: getNativeBalance,
  },
  approvals: {
    listPending: listPendingApprovals,
    getDetail: getApprovalDetail,
    resolve: resolveApproval,
  },
  keyrings: {
    list: listKeyrings,
    getAccountsByKeyring,
    getBackupStatus,
    confirmNewMnemonic,
    importMnemonic,
    importPrivateKey,
    deriveAccount,
    renameKeyring,
    renameAccount,
    markBackedUp,
    hideHdAccount,
    unhideHdAccount,
    removePrivateKeyKeyring,
    exportMnemonic,
    exportPrivateKey,
  },
  transactions: {
    listHistory: listTransactionHistory,
    getDetail: getTransactionDetail,
    requestSendTransactionApproval,
    rerunPrepare: rerunTransactionPrepare,
    applyDraftEdit: applyTransactionDraftEdit,
  },
} as const satisfies WalletMethodHandlerTree<WalletApiContext, TrustedWalletApi>;
