import type { NativeCurrency } from "../chains/definition.js";
import type { ChainRef } from "../chains/ids.js";
import type { AccountKey } from "../storage/records.js";
import type { ListTransactionsQuery } from "../transactions/TransactionsService.js";
import type { ApprovalDetail, ApprovalListEntry } from "../ui/protocol/models/approvals.js";
import type { UiTransaction } from "../ui/protocol/models/transactions.js";
import type { UiAccountMeta, UiBackupStatus, UiKeyringMeta, UiSnapshot } from "../ui/protocol/schemas.js";

export type CoreReadUnsubscribe = () => void;

/** Payloadless invalidation signal; consumers should re-read the snapshot they need. */
export type CoreReadChangeListener = () => void;

export type CoreReadKeyringListResult = UiKeyringMeta[];

export type CoreReadAccountsByKeyringInput = {
  keyringId: string;
  includeHidden?: boolean;
};

export type CoreReadAccountsByKeyringResult = UiAccountMeta[];

export type CoreReadBackupStatusResult = UiBackupStatus;

export type CoreReadNativeBalanceInput = {
  accountKey: AccountKey;
  chainRef: ChainRef;
};

export type CoreReadNativeBalanceResult = {
  accountKey: AccountKey;
  chainRef: ChainRef;
  amount: string;
  currency: NativeCurrency;
};

export type CoreReadPendingApprovalsResult = ApprovalListEntry[];

export type CoreReadApprovalDetailInput = {
  approvalId: string;
};

export type CoreReadApprovalDetailResult = ApprovalDetail | null;

export type CoreReadTransactionsInput = ListTransactionsQuery;

export type CoreReadTransactionsResult = UiTransaction[];

export type CoreReadTransactionDetailInput = {
  transactionId: string;
};

export type CoreReadTransactionDetailResult = UiTransaction | null;

export type CoreReadApi = Readonly<{
  /** Wallet UI read model, detached from mutable owner state. */
  getWalletSnapshot(): UiSnapshot;
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
