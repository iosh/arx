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
  unlockSession: (input) => unlockSession(context, input),
  lockSession: (input) => lockSession(context, input),
  resetAutoLockTimer: () => resetAutoLockTimer(context),
  setAutoLockDuration: (input) => setAutoLockDuration(context, input),
  generateMnemonic: (input) => generateMnemonic(context, input),
  createWalletFromMnemonic: (input) => createWalletFromMnemonic(context, input),
  importWalletFromMnemonic: (input) => importWalletFromMnemonic(context, input),
  importWalletFromPrivateKey: (input) => importWalletFromPrivateKey(context, input),
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
  switchActiveAccount: (input) => switchActiveAccount(context, input),
  selectWalletChain: (input) => selectWalletChain(context, input),
  resolveApproval: (input) => resolveApproval(context, input),
  requestSendTransactionApproval: (input) => requestSendTransactionApproval(context, input),
  rerunTransactionPrepare: (input) => rerunTransactionPrepare(context, input),
  applyTransactionDraftEdit: (input) => applyTransactionDraftEdit(context, input),
});
