import type { NativeCurrency } from "../chains/definition.js";
import type { ChainRef } from "../chains/ids.js";
import type { ChainView, UiNetworksSnapshot } from "../services/runtime/chainViews/types.js";
import type { SessionStatus } from "../services/runtime/sessionStatus.js";
import type { AccountKey } from "../storage/records.js";
import type { ApprovalDetail, ApprovalListEntry } from "../ui/protocol/models/approvals.js";
import type { UiTransaction } from "../ui/protocol/models/transactions.js";
import type { UiAccountMeta, UiBackupStatus, UiKeyringMeta } from "../ui/protocol/schemas.js";

export type WalletApiSessionStatusResult = SessionStatus;

export type WalletApiAccountsForCurrentChainResult = {
  totalCount: number;
  list: WalletApiOwnedAccountSummary[];
  active: WalletApiOwnedAccountSummary | null;
};

export type WalletApiNetworksResult = UiNetworksSnapshot;

export type WalletApiAutoLockResult = {
  autoLockDurationMs: number;
  nextAutoLockAt: number | null;
};

export type WalletApiGenerateMnemonicResult = {
  words: string[];
};

export type WalletApiAvailability = "uninitialized" | "empty" | "ready";

export type WalletApiOnboardingStatusResult = {
  availability: WalletApiAvailability;
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

export type WalletApiRequestSendTransactionApprovalResult = {
  approvalId: string;
};

export type WalletApiOwnedAccountSummary = {
  accountKey: AccountKey;
  canonicalAddress: string;
  displayAddress: string;
};

export type WalletApiChainSnapshot = ChainView;
export type WalletApiResolveApprovalResult = null;

export type WalletApiKeyringListResult = UiKeyringMeta[];

export type WalletApiAccountsByKeyringResult = UiAccountMeta[];

export type WalletApiBackupStatusResult = UiBackupStatus;

export type WalletApiNativeBalanceResult = {
  accountKey: AccountKey;
  chainRef: ChainRef;
  amount: string;
  currency: NativeCurrency;
};

export type WalletApiPendingApprovalsResult = ApprovalListEntry[];

export type WalletApiApprovalDetailResult = ApprovalDetail | null;

export type WalletApiTransactionsResult = UiTransaction[];

export type WalletApiTransactionDetailResult = UiTransaction | null;
