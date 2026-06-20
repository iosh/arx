import { switchActiveAccount } from "./actions/accounts.js";
import { resolveApproval } from "./actions/approvals.js";
import { selectWalletChain } from "./actions/chains.js";
import {
  confirmNewMnemonic,
  deriveAccount,
  exportMnemonic,
  exportPrivateKey,
  hideHdAccount,
  importMnemonic,
  importPrivateKey,
  markBackedUp,
  removePrivateKeyKeyring,
  renameAccount,
  renameKeyring,
  unhideHdAccount,
} from "./actions/keyrings.js";
import {
  createWalletFromMnemonic,
  generateMnemonic,
  importWalletFromMnemonic,
  importWalletFromPrivateKey,
} from "./actions/onboarding.js";
import { lockSession, resetAutoLockTimer, setAutoLockDuration, unlockSession } from "./actions/session.js";
import {
  applyTransactionDraftEdit,
  requestSendTransactionApproval,
  rerunTransactionPrepare,
} from "./actions/transactions.js";
import type { TrustedWalletApi } from "./api.js";
import type { WalletApiContext } from "./context.js";

export const createTrustedWalletApi = (context: WalletApiContext): TrustedWalletApi => ({
  snapshot: {
    get: () => context.read.getWalletSnapshot(),
    subscribe: (listener) => context.read.subscribe(listener),
  },
  session: {
    unlock: (input) => unlockSession(context, input),
    lock: (input) => lockSession(context, input),
    resetAutoLockTimer: () => resetAutoLockTimer(context),
    setAutoLockDuration: (input) => setAutoLockDuration(context, input),
  },
  onboarding: {
    generateMnemonic: (input) => generateMnemonic(context, input),
    createWalletFromMnemonic: (input) => createWalletFromMnemonic(context, input),
    importWalletFromMnemonic: (input) => importWalletFromMnemonic(context, input),
    importWalletFromPrivateKey: (input) => importWalletFromPrivateKey(context, input),
  },
  accounts: {
    switchActive: (input) => switchActiveAccount(context, input),
  },
  networks: {
    select: (input) => selectWalletChain(context, input),
  },
  balances: {
    getNative: (input) => context.read.getNativeBalance(input),
  },
  approvals: {
    listPending: () => context.read.listPendingApprovals(),
    getDetail: (input) => context.read.getApprovalDetail(input),
    resolve: (input) => resolveApproval(context, input),
  },
  keyrings: {
    list: () => context.read.listKeyrings(),
    getAccountsByKeyring: (input) => context.read.getAccountsByKeyring(input),
    getBackupStatus: () => context.read.getBackupStatus(),
    confirmNewMnemonic: (input) => confirmNewMnemonic(context, input),
    importMnemonic: (input) => importMnemonic(context, input),
    importPrivateKey: (input) => importPrivateKey(context, input),
    deriveAccount: (input) => deriveAccount(context, input),
    renameKeyring: (input) => renameKeyring(context, input),
    renameAccount: (input) => renameAccount(context, input),
    markBackedUp: (input) => markBackedUp(context, input),
    hideHdAccount: (input) => hideHdAccount(context, input),
    unhideHdAccount: (input) => unhideHdAccount(context, input),
    removePrivateKeyKeyring: (input) => removePrivateKeyKeyring(context, input),
    exportMnemonic: (input) => exportMnemonic(context, input),
    exportPrivateKey: (input) => exportPrivateKey(context, input),
  },
  transactions: {
    listHistory: (input) => context.read.listTransactions(input),
    getDetail: (input) => context.read.getTransactionDetail(input),
    requestSendTransactionApproval: (input) => requestSendTransactionApproval(context, input),
    rerunPrepare: (input) => rerunTransactionPrepare(context, input),
    applyDraftEdit: (input) => applyTransactionDraftEdit(context, input),
  },
});
