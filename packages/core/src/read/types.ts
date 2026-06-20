import type {
  WalletApiAccountsByKeyringInput,
  WalletApiAccountsByKeyringResult,
  WalletApiApprovalDetailInput,
  WalletApiApprovalDetailResult,
  WalletApiBackupStatusResult,
  WalletApiKeyringListResult,
  WalletApiNativeBalanceInput,
  WalletApiNativeBalanceResult,
  WalletApiPendingApprovalsResult,
  WalletApiSnapshot,
  WalletApiSnapshotChangeListener,
  WalletApiTransactionDetailInput,
  WalletApiTransactionDetailResult,
  WalletApiTransactionsInput,
  WalletApiTransactionsResult,
  WalletApiUnsubscribe,
} from "../wallet/types.js";

export type CoreReadUnsubscribe = WalletApiUnsubscribe;

/** Payloadless invalidation signal; consumers should re-read the snapshot they need. */
export type CoreReadChangeListener = WalletApiSnapshotChangeListener;

export type CoreReadKeyringListResult = WalletApiKeyringListResult;

export type CoreReadAccountsByKeyringInput = WalletApiAccountsByKeyringInput;

export type CoreReadAccountsByKeyringResult = WalletApiAccountsByKeyringResult;

export type CoreReadBackupStatusResult = WalletApiBackupStatusResult;

export type CoreReadNativeBalanceInput = WalletApiNativeBalanceInput;

export type CoreReadNativeBalanceResult = WalletApiNativeBalanceResult;

export type CoreReadPendingApprovalsResult = WalletApiPendingApprovalsResult;

export type CoreReadApprovalDetailInput = WalletApiApprovalDetailInput;

export type CoreReadApprovalDetailResult = WalletApiApprovalDetailResult;

export type CoreReadTransactionsInput = WalletApiTransactionsInput;

export type CoreReadTransactionsResult = WalletApiTransactionsResult;

export type CoreReadTransactionDetailInput = WalletApiTransactionDetailInput;

export type CoreReadTransactionDetailResult = WalletApiTransactionDetailResult;

export type CoreReadApi = Readonly<{
  /** Wallet UI read model, detached from mutable owner state. */
  getWalletSnapshot(): WalletApiSnapshot;
  listKeyrings(): CoreReadKeyringListResult;
  getAccountsByKeyring(input: CoreReadAccountsByKeyringInput): CoreReadAccountsByKeyringResult;
  getBackupStatus(): CoreReadBackupStatusResult;
  getNativeBalance(input: CoreReadNativeBalanceInput): Promise<CoreReadNativeBalanceResult>;
  listPendingApprovals(): Promise<CoreReadPendingApprovalsResult>;
  getApprovalDetail(input: CoreReadApprovalDetailInput): Promise<CoreReadApprovalDetailResult>;
  listTransactions(input?: CoreReadTransactionsInput): Promise<CoreReadTransactionsResult>;
  getTransactionDetail(input: CoreReadTransactionDetailInput): Promise<CoreReadTransactionDetailResult>;
  /** Subscribe to post-subscription invalidations; callers read the initial snapshot explicitly. */
  subscribe(listener: CoreReadChangeListener): CoreReadUnsubscribe;
}>;
