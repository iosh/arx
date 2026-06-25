import type { ApprovalAccountSelectionDecision } from "../approvals/queue/types.js";
import type { ChainRef } from "../chains/ids.js";
import type { SessionLockState } from "../runtime/session/unlock/types.js";
import type { AccountKey } from "../storage/records.js";
import type { TransactionStatus } from "../transactions/aggregate/index.js";
import type {
  Eip155TransactionDraftChange,
  NamespaceTransactionDraftEdit as TransactionNamespaceDraftEdit,
  WalletTransactionRequest,
} from "../transactions/index.js";
import type {
  WalletApiAccountsByKeyringResult,
  WalletApiAccountsForCurrentChainResult,
  WalletApiApprovalDetailResult,
  WalletApiAutoLockResult,
  WalletApiBackupStatusResult,
  WalletApiChainSnapshot,
  WalletApiCreationResult,
  WalletApiExportMnemonicResult,
  WalletApiExportPrivateKeyResult,
  WalletApiGenerateMnemonicResult,
  WalletApiImportPrivateKeyResult,
  WalletApiKeyringAccount,
  WalletApiKeyringListResult,
  WalletApiNativeBalanceResult,
  WalletApiNetworksResult,
  WalletApiOwnedAccountSummary,
  WalletApiPendingApprovalsResult,
  WalletApiRequestSendTransactionApprovalResult,
  WalletApiResolveApprovalResult,
  WalletApiSessionStatusResult,
  WalletApiSetupStatusResult,
  WalletApiTransactionDetailResult,
  WalletApiTransactionsResult,
} from "./types.js";

export type { Eip155TransactionDraftChange };

export type UnlockSessionInput = { password: string };
export type LockSessionInput = { reason?: "manual" | "timeout" | "blur" | "suspend" | "reload" };
export type SetAutoLockDurationInput = { durationMs: number };

export type GenerateMnemonicInput = { wordCount?: 12 | 24 };
export type CreateWalletFromMnemonicInput = {
  password: string;
  words: readonly string[];
  alias?: string;
  skipBackup?: boolean;
  namespace?: string;
};
export type ImportWalletFromMnemonicInput = {
  password: string;
  words: readonly string[];
  alias?: string;
  namespace?: string;
};
export type ImportWalletFromPrivateKeyInput = {
  password: string;
  privateKey: string;
  alias?: string;
  namespace?: string;
};

export type SwitchActiveAccountInput = {
  chainRef: ChainRef;
  accountKey?: AccountKey | null;
};
export type SelectWalletChainInput = { chainRef: ChainRef };
export type WalletApiNativeBalanceInput = {
  chainRef: ChainRef;
  accountKey: AccountKey;
};

export type WalletApiApprovalDetailInput = { approvalId: string };
export type ResolveApprovalInput =
  | {
      approvalId: string;
      action: "approve";
      decision?: ApprovalAccountSelectionDecision;
      expectedPrepareId?: string;
    }
  | {
      approvalId: string;
      action: "reject";
      reason?: string;
    };

export type WalletApiAccountsByKeyringInput = {
  keyringId: string;
  includeHidden?: boolean;
};
export type ConfirmNewMnemonicInput = {
  words: readonly string[];
  alias?: string;
  skipBackup?: boolean;
  namespace?: string;
};
export type ImportMnemonicInput = {
  words: readonly string[];
  alias?: string;
  namespace?: string;
};
export type ImportPrivateKeyInput = {
  privateKey: string;
  alias?: string;
  namespace?: string;
};
export type DeriveAccountInput = { keyringId: string };
export type RenameKeyringInput = { keyringId: string; alias: string };
export type RenameAccountInput = { accountKey: AccountKey; alias: string };
export type MarkBackedUpInput = { keyringId: string };
export type HideHdAccountInput = { accountKey: AccountKey };
export type UnhideHdAccountInput = { accountKey: AccountKey };
export type RemovePrivateKeyKeyringInput = { keyringId: string };
export type ExportMnemonicInput = { keyringId: string; password: string };
export type ExportPrivateKeyInput = { accountKey: AccountKey; password: string };

export type RequestSendTransactionApprovalInput = {
  request: WalletTransactionRequest;
};
export type WalletApiTransactionsInput = {
  namespace?: string;
  chainRef?: ChainRef;
  accountKey?: AccountKey;
  status?: TransactionStatus;
  limit?: number;
  before?: {
    createdAt: number;
    id: string;
  };
};
export type WalletApiTransactionDetailInput = { transactionId: string };
export type RerunTransactionPrepareInput = { approvalId: string };
export type NamespaceTransactionDraftEdit = Omit<TransactionNamespaceDraftEdit, "changes"> & {
  readonly changes: readonly Eip155TransactionDraftChange[];
};
export type ApplyTransactionDraftEditInput = {
  approvalId: string;
  edit: NamespaceTransactionDraftEdit;
  mode?: string;
};

export type TrustedWalletApi = Readonly<{
  session: Readonly<{
    getStatus(): Promise<WalletApiSessionStatusResult>;
    unlock(input: UnlockSessionInput): Promise<SessionLockState>;
    lock(input?: LockSessionInput): Promise<SessionLockState>;
    resetAutoLockTimer(): Promise<SessionLockState>;
    setAutoLockDuration(input: SetAutoLockDurationInput): Promise<WalletApiAutoLockResult>;
  }>;

  setup: Readonly<{
    getStatus(): Promise<WalletApiSetupStatusResult>;
    generateMnemonic(input?: GenerateMnemonicInput): Promise<WalletApiGenerateMnemonicResult>;
    createWalletFromMnemonic(input: CreateWalletFromMnemonicInput): Promise<WalletApiCreationResult>;
    importWalletFromMnemonic(input: ImportWalletFromMnemonicInput): Promise<WalletApiCreationResult>;
    importWalletFromPrivateKey(input: ImportWalletFromPrivateKeyInput): Promise<WalletApiImportPrivateKeyResult>;
  }>;

  accounts: Readonly<{
    listCurrentChain(): Promise<WalletApiAccountsForCurrentChainResult>;
    switchActive(input: SwitchActiveAccountInput): Promise<WalletApiOwnedAccountSummary | null>;
  }>;

  networks: Readonly<{
    getSelectedChain(): Promise<WalletApiChainSnapshot>;
    list(): Promise<WalletApiNetworksResult>;
    select(input: SelectWalletChainInput): Promise<WalletApiChainSnapshot>;
  }>;

  balances: Readonly<{
    getNative(input: WalletApiNativeBalanceInput): Promise<WalletApiNativeBalanceResult>;
  }>;

  approvals: Readonly<{
    listPending(): Promise<WalletApiPendingApprovalsResult>;
    getDetail(input: WalletApiApprovalDetailInput): Promise<WalletApiApprovalDetailResult>;
    resolve(input: ResolveApprovalInput): Promise<WalletApiResolveApprovalResult>;
  }>;

  keyrings: Readonly<{
    list(): Promise<WalletApiKeyringListResult>;
    getAccountsByKeyring(input: WalletApiAccountsByKeyringInput): Promise<WalletApiAccountsByKeyringResult>;
    getBackupStatus(): Promise<WalletApiBackupStatusResult>;
    confirmNewMnemonic(input: ConfirmNewMnemonicInput): Promise<WalletApiCreationResult>;
    importMnemonic(input: ImportMnemonicInput): Promise<WalletApiCreationResult>;
    importPrivateKey(input: ImportPrivateKeyInput): Promise<WalletApiImportPrivateKeyResult>;
    deriveAccount(input: DeriveAccountInput): Promise<WalletApiKeyringAccount>;
    renameKeyring(input: RenameKeyringInput): Promise<null>;
    renameAccount(input: RenameAccountInput): Promise<null>;
    markBackedUp(input: MarkBackedUpInput): Promise<null>;
    hideHdAccount(input: HideHdAccountInput): Promise<null>;
    unhideHdAccount(input: UnhideHdAccountInput): Promise<null>;
    removePrivateKeyKeyring(input: RemovePrivateKeyKeyringInput): Promise<null>;
    exportMnemonic(input: ExportMnemonicInput): Promise<WalletApiExportMnemonicResult>;
    exportPrivateKey(input: ExportPrivateKeyInput): Promise<WalletApiExportPrivateKeyResult>;
  }>;

  transactions: Readonly<{
    listHistory(input?: WalletApiTransactionsInput): Promise<WalletApiTransactionsResult>;
    getDetail(input: WalletApiTransactionDetailInput): Promise<WalletApiTransactionDetailResult>;
    requestSendTransactionApproval(
      input: RequestSendTransactionApprovalInput,
    ): Promise<WalletApiRequestSendTransactionApprovalResult>;
    rerunPrepare(input: RerunTransactionPrepareInput): Promise<null>;
    applyDraftEdit(input: ApplyTransactionDraftEditInput): Promise<null>;
  }>;
}>;

type AssertNever<T extends never> = T;
type WalletApiForbiddenKey = "read" | "dispatch" | "dispatchRequest" | "buildSnapshotEvent";

type _TrustedWalletApiDoesNotExposeProtocolKeys = AssertNever<Extract<keyof TrustedWalletApi, WalletApiForbiddenKey>>;
