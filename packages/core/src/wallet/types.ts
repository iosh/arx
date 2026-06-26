import type { ApprovalKind, ApprovalKinds } from "../approvals/queue/types.js";
import type { ApprovalSource } from "../approvals/source.js";
import type { NativeCurrency } from "../chains/definition.js";
import type { ChainRef } from "../chains/ids.js";
import type { ChainView } from "../services/runtime/chainViews/types.js";
import type { SessionStatus } from "../services/runtime/sessionStatus.js";
import type { AccountKey } from "../storage/records.js";
import type {
  JsonValue,
  TransactionReplacementType,
  TransactionSource,
  TransactionStatus,
  TransactionTerminalReason,
} from "../transactions/aggregate/index.js";
import type { SendTransactionApprovalReview } from "../transactions/review/types.js";

export type PermissionsSnapshot = {
  origins: Record<
    string,
    Record<
      string,
      {
        chains: Record<
          ChainRef,
          {
            accountKeys: AccountKey[];
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
  accountKey: AccountKey;
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

export type ApprovalSelectableAccount = {
  accountKey: AccountKey;
  canonicalAddress: string;
  displayAddress: string;
};

export type ApprovalListEntry = {
  approvalId: string;
  kind: ApprovalKind;
  source: ApprovalSource;
  origin: string;
  namespace: string;
  chainRef: ChainRef;
  createdAt: number;
};

type ApprovalDetailBase<K extends ApprovalKind, Request, Review> = {
  approvalId: string;
  kind: K;
  source: ApprovalSource;
  origin: string;
  namespace: string;
  chainRef: ChainRef;
  createdAt: number;
  actions: {
    canApprove: boolean;
    canReject: boolean;
  };
  request: Request;
  review: Review;
};

type RequestAccountsRequest = {
  selectableAccounts: ApprovalSelectableAccount[];
  recommendedAccountKey: AccountKey | null;
};

type RequestPermissionsRequest = {
  selectableAccounts: ApprovalSelectableAccount[];
  recommendedAccountKey: AccountKey | null;
  requestedGrants: Array<{
    grantKind: string;
    chainRef: ChainRef;
  }>;
};

type SignMessageRequest = {
  from: string;
  message: string;
};

type SignTypedDataRequest = {
  from: string;
  typedData: string;
};

type SwitchChainRequest = {
  chainRef: ChainRef;
  chainId?: string | undefined;
  displayName?: string | undefined;
};

type AddChainRequest = {
  chainRef: ChainRef;
  chainId: string;
  displayName: string;
  rpcUrls: string[];
  nativeCurrency?:
    | {
        name: string;
        symbol: string;
        decimals: number;
      }
    | undefined;
  blockExplorerUrl?: string | undefined;
  isUpdate: boolean;
};

type SendTransactionRequest = {
  approvalId: string;
  chainRef: ChainRef;
  origin: string;
  prepareId: string | null;
};

export type ApprovalAccountSelectionDetail =
  | ApprovalDetailBase<typeof ApprovalKinds.RequestAccounts, RequestAccountsRequest, null>
  | ApprovalDetailBase<typeof ApprovalKinds.RequestPermissions, RequestPermissionsRequest, null>;

export type ApprovalStaticDetail =
  | ApprovalDetailBase<typeof ApprovalKinds.SignMessage, SignMessageRequest, null>
  | ApprovalDetailBase<typeof ApprovalKinds.SignTypedData, SignTypedDataRequest, null>
  | ApprovalDetailBase<typeof ApprovalKinds.SwitchChain, SwitchChainRequest, null>
  | ApprovalDetailBase<typeof ApprovalKinds.AddChain, AddChainRequest, null>;

export type ApprovalSendTransactionDetail = ApprovalDetailBase<
  typeof ApprovalKinds.SendTransaction,
  SendTransactionRequest,
  SendTransactionApprovalReview
>;

export type ApprovalDetail = ApprovalAccountSelectionDetail | ApprovalStaticDetail | ApprovalSendTransactionDetail;

export type ResolveApprovalResult = null;

export type NetworksSnapshot = {
  selectedNamespace: string;
  active: ChainRef;
  known: ChainView[];
  available: ChainView[];
};

export type Transaction = {
  id: string;
  status: TransactionStatus;
  namespace: string;
  chainRef: ChainRef;
  source: TransactionSource;
  origin: string;
  account: {
    accountKey: AccountKey;
    address: string;
  };
  submitted: JsonValue | null;
  receipt: JsonValue | null;
  replacement: {
    replaces: {
      transactionId: string;
      type: TransactionReplacementType;
    } | null;
    replacedBy: {
      transactionId: string;
    } | null;
  } | null;
  terminalReason: TransactionTerminalReason | null;
  createdAt: number;
  updatedAt: number;
};

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

export type WalletApiGenerateMnemonicResult = {
  words: string[];
};

export type WalletSetupAvailability = "uninitialized" | "empty" | "ready";

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

export type WalletApiRequestSendTransactionApprovalResult = {
  approvalId: string;
};

export type WalletApiOwnedAccountSummary = {
  accountKey: AccountKey;
  canonicalAddress: string;
  displayAddress: string;
};

export type WalletApiChainSnapshot = ChainView;
export type WalletApiResolveApprovalResult = ResolveApprovalResult;

export type WalletApiKeyringListResult = KeyringMeta[];

export type WalletApiAccountsByKeyringResult = AccountMeta[];

export type WalletApiBackupStatusResult = BackupStatus;

export type WalletApiNativeBalanceResult = {
  accountKey: AccountKey;
  chainRef: ChainRef;
  amount: string;
  currency: NativeCurrency;
};

export type WalletApiPendingApprovalsResult = ApprovalListEntry[];

export type WalletApiApprovalDetailResult = ApprovalDetail | null;

export type WalletApiTransactionsResult = Transaction[];

export type WalletApiTransactionDetailResult = Transaction | null;
