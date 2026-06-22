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
import { createWalletOperationExecutor } from "./executor.js";
import type { WalletOperationPath } from "./operation.js";
import { walletOperationHandlers } from "./operationHandlers.js";
import { walletOperations } from "./operations.js";

const setupGetStatusPath = "setup.getStatus" satisfies WalletOperationPath<typeof walletOperations>;

export const createTrustedWalletApi = (context: WalletApiContext): TrustedWalletApi => {
  const walletExecutor = createWalletOperationExecutor({
    context,
    operations: walletOperations,
    handlers: walletOperationHandlers,
  });
  const getSetupStatusFromExecutor: TrustedWalletApi["setup"]["getStatus"] = () =>
    walletExecutor.executePath(setupGetStatusPath, undefined);

  return {
    session: {
      getStatus: () => getSessionStatus(context),
      unlock: (input) => unlockSession(context, input),
      lock: (input) => lockSession(context, input),
      resetAutoLockTimer: () => resetAutoLockTimer(context),
      setAutoLockDuration: (input) => setAutoLockDuration(context, input),
    },
    setup: {
      getStatus: getSetupStatusFromExecutor,
      generateMnemonic: (input) => generateMnemonic(context, input),
      createWalletFromMnemonic: (input) => createWalletFromMnemonic(context, input),
      importWalletFromMnemonic: (input) => importWalletFromMnemonic(context, input),
      importWalletFromPrivateKey: (input) => importWalletFromPrivateKey(context, input),
    },
    accounts: {
      listCurrentChain: () => listAccountsForCurrentChain(context),
      switchActive: (input) => switchActiveAccount(context, input),
    },
    networks: {
      getSelectedChain: () => getSelectedWalletChain(context),
      list: () => listWalletNetworks(context),
      select: (input) => selectWalletChain(context, input),
    },
    balances: {
      getNative: (input) => getNativeBalance(context, input),
    },
    approvals: {
      listPending: () => listPendingApprovals(context),
      getDetail: (input) => getApprovalDetail(context, input),
      resolve: (input) => resolveApproval(context, input),
    },
    keyrings: {
      list: () => listKeyrings(context),
      getAccountsByKeyring: (input) => getAccountsByKeyring(context, input),
      getBackupStatus: () => getBackupStatus(context),
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
      listHistory: (input) => listTransactionHistory(context, input),
      getDetail: (input) => getTransactionDetail(context, input),
      requestSendTransactionApproval: (input) => requestSendTransactionApproval(context, input),
      rerunPrepare: (input) => rerunTransactionPrepare(context, input),
      applyDraftEdit: (input) => applyTransactionDraftEdit(context, input),
    },
  };
};
