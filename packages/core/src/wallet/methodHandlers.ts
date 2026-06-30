import type { MethodHandlerTree } from "../invoke/methods.js";
import { listAccountsForCurrentChain, switchActiveAccount } from "./actions/accounts.js";
import { dismissApproval, getApprovalDetail, listPendingApprovals, resolveApproval } from "./actions/approvals.js";
import { getAttentionSnapshot } from "./actions/attention.js";
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
  restoreWalletFromMnemonic,
  restoreWalletFromPrivateKey,
} from "./actions/setup.js";
import {
  applyTransactionDraftEdit,
  getTransactionDetail,
  listTransactionHistory,
  requestSendTransactionApproval,
  rerunTransactionPrepare,
} from "./actions/transactions.js";
import type { WalletApi } from "./api.js";
import type { WalletApiContext } from "./context.js";

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
    restoreWalletFromMnemonic,
    restoreWalletFromPrivateKey,
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
  attention: {
    getSnapshot: getAttentionSnapshot,
  },
  approvals: {
    listPending: listPendingApprovals,
    getDetail: getApprovalDetail,
    dismiss: dismissApproval,
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
} as const satisfies MethodHandlerTree<WalletApiContext, WalletApi>;
