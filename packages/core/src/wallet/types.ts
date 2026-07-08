import type { ApprovalDetail, ApprovalListEntry } from "../approvals/approvalDetails.js";
import type { NativeCurrency } from "../chains/definition.js";
import type { ChainRef } from "../chains/ids.js";
import type { ChainView, NetworksSnapshot } from "../chains/views/types.js";
import type { SessionStatus } from "../runtime/background/session.js";
import type { AccountId } from "../storage/records.js";
import type { SubmitTransactionResult, Transaction, TransactionProposal } from "../transactions/TransactionsService.js";
import type { WalletApiAttentionSnapshot } from "./api.js";

export type { ApprovalDetail, ApprovalListEntry, ApprovalSelectableAccount } from "../approvals/approvalDetails.js";
export type { NetworksSnapshot } from "../chains/views/types.js";
export type { Transaction } from "../transactions/TransactionsService.js";

export type PermissionsSnapshot = {
  origins: Record<
    string,
    Record<
      string,
      {
        chains: Record<
          ChainRef,
          {
            accountIds: AccountId[];
          }
        >;
      }
    >
  >;
};

export type KeyringMeta = {
  id: string;
  type: "hd" | "private-key";
  createdAt: number;
  alias?: string | undefined;
  backedUp?: boolean | undefined;
  derivedCount?: number | undefined;
};

export type AccountMeta = {
  accountId: AccountId;
  canonicalAddress: string;
  keyringId: string;
  derivationIndex?: number | undefined;
  alias?: string | undefined;
  createdAt: number;
  hidden?: boolean | undefined;
};

export type BackupReminder = {
  keyringId: string;
  alias: string | null;
};

export type BackupStatus = {
  pendingHdKeyringCount: number;
  nextHdKeyring: BackupReminder | null;
};

export type ResolveApprovalResult = null;

export type WalletApiSessionStatusResult = SessionStatus;

export type WalletApiAccountsForCurrentChainResult = {
  totalCount: number;
  list: WalletApiOwnedAccountSummary[];
  active: WalletApiOwnedAccountSummary | null;
};

export type WalletApiNetworksResult = NetworksSnapshot;

export type WalletApiAutoLockResult = {
  autoLockDurationMs: number;
  nextAutoLockAt: number | null;
};

export type WalletApiAttentionSnapshotResult = WalletApiAttentionSnapshot;

export type WalletApiGenerateMnemonicResult = {
  words: string[];
};

export type WalletSetupAvailability = "uninitialized" | "ready";

export type WalletApiSetupStatusResult = {
  availability: WalletSetupAvailability;
};

export type WalletApiKeyringAccount = {
  address: string;
  derivationPath: string | null;
  derivationIndex: number | null;
  source: "derived" | "imported";
};

export type WalletApiCreationResult = {
  keyringId: string;
  address: string;
};

export type WalletApiImportPrivateKeyResult = {
  keyringId: string;
  account: WalletApiKeyringAccount;
};

export type WalletApiExportMnemonicResult = {
  words: string[];
};

export type WalletApiExportPrivateKeyResult = {
  privateKey: string;
};

export type WalletApiPrepareTransactionResult = TransactionProposal;
export type WalletApiSubmitTransactionResult = SubmitTransactionResult;

export type WalletApiOwnedAccountSummary = {
  accountId: AccountId;
  canonicalAddress: string;
  displayAddress: string;
};

export type WalletApiChainSnapshot = ChainView;
export type WalletApiResolveApprovalResult = ResolveApprovalResult;

export type WalletApiKeyringListResult = KeyringMeta[];

export type WalletApiAccountsByKeyringResult = AccountMeta[];

export type WalletApiBackupStatusResult = BackupStatus;

export type WalletApiNativeBalanceResult = {
  accountId: AccountId;
  chainRef: ChainRef;
  amount: string;
  currency: NativeCurrency;
};

export type WalletApiPendingApprovalsResult = ApprovalListEntry[];

export type WalletApiApprovalDetailResult = ApprovalDetail | null;

export type WalletApiTransactionsResult = Transaction[];

export type WalletApiTransactionDetailResult = Transaction | null;
