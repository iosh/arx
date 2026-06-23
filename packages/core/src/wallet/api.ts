import type { z } from "zod";
import type { SessionLockState } from "../runtime/session/unlock/types.js";
import type { WalletApiEip155TransactionDraftChangeSchema } from "./schemas/transactions.js";
import type { WalletApiSchemas } from "./schemas.js";
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

type WalletApiInput<TSchema extends z.ZodTypeAny> = z.input<TSchema>;

export type UnlockSessionInput = WalletApiInput<typeof WalletApiSchemas.session.unlock>;
export type LockSessionInput = WalletApiInput<typeof WalletApiSchemas.session.lock>;
export type SetAutoLockDurationInput = WalletApiInput<typeof WalletApiSchemas.session.setAutoLockDuration>;

export type GenerateMnemonicInput = NonNullable<WalletApiInput<typeof WalletApiSchemas.setup.generateMnemonic>>;
export type CreateWalletFromMnemonicInput = WalletApiInput<typeof WalletApiSchemas.setup.createWalletFromMnemonic>;
export type ImportWalletFromMnemonicInput = WalletApiInput<typeof WalletApiSchemas.setup.importWalletFromMnemonic>;
export type ImportWalletFromPrivateKeyInput = WalletApiInput<typeof WalletApiSchemas.setup.importWalletFromPrivateKey>;

export type SwitchActiveAccountInput = WalletApiInput<typeof WalletApiSchemas.accounts.switchActive>;
export type SelectWalletChainInput = WalletApiInput<typeof WalletApiSchemas.chains.selectWalletChain>;
export type WalletApiNativeBalanceInput = WalletApiInput<typeof WalletApiSchemas.balances.getNative>;

export type WalletApiApprovalDetailInput = WalletApiInput<typeof WalletApiSchemas.approvals.getDetail>;
export type ResolveApprovalInput = WalletApiInput<typeof WalletApiSchemas.approvals.resolve>;

export type WalletApiAccountsByKeyringInput = WalletApiInput<typeof WalletApiSchemas.keyrings.getAccountsByKeyring>;
export type ConfirmNewMnemonicInput = WalletApiInput<typeof WalletApiSchemas.keyrings.confirmNewMnemonic>;
export type ImportMnemonicInput = WalletApiInput<typeof WalletApiSchemas.keyrings.importMnemonic>;
export type ImportPrivateKeyInput = WalletApiInput<typeof WalletApiSchemas.keyrings.importPrivateKey>;
export type DeriveAccountInput = WalletApiInput<typeof WalletApiSchemas.keyrings.deriveAccount>;
export type RenameKeyringInput = WalletApiInput<typeof WalletApiSchemas.keyrings.renameKeyring>;
export type RenameAccountInput = WalletApiInput<typeof WalletApiSchemas.keyrings.renameAccount>;
export type MarkBackedUpInput = WalletApiInput<typeof WalletApiSchemas.keyrings.markBackedUp>;
export type HideHdAccountInput = WalletApiInput<typeof WalletApiSchemas.keyrings.hideHdAccount>;
export type UnhideHdAccountInput = WalletApiInput<typeof WalletApiSchemas.keyrings.unhideHdAccount>;
export type RemovePrivateKeyKeyringInput = WalletApiInput<typeof WalletApiSchemas.keyrings.removePrivateKeyKeyring>;
export type ExportMnemonicInput = WalletApiInput<typeof WalletApiSchemas.keyrings.exportMnemonic>;
export type ExportPrivateKeyInput = WalletApiInput<typeof WalletApiSchemas.keyrings.exportPrivateKey>;

export type RequestSendTransactionApprovalInput = WalletApiInput<
  typeof WalletApiSchemas.transactions.requestSendTransactionApproval
>;
export type WalletApiTransactionsInput = WalletApiInput<typeof WalletApiSchemas.transactions.listHistory>;
export type WalletApiTransactionDetailInput = WalletApiInput<typeof WalletApiSchemas.transactions.getDetail>;
export type RerunTransactionPrepareInput = WalletApiInput<typeof WalletApiSchemas.transactions.rerunPrepare>;
export type Eip155TransactionDraftChange = WalletApiInput<typeof WalletApiEip155TransactionDraftChangeSchema>;
export type NamespaceTransactionDraftEdit = Omit<
  WalletApiInput<typeof WalletApiSchemas.transactions.applyDraftEdit>["edit"],
  "changes"
> & {
  readonly changes: readonly Eip155TransactionDraftChange[];
};
export type ApplyTransactionDraftEditInput = Omit<
  WalletApiInput<typeof WalletApiSchemas.transactions.applyDraftEdit>,
  "edit"
> & {
  edit: NamespaceTransactionDraftEdit;
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
type WalletApiForbiddenKey = "read" | "dispatch" | "dispatchRequest" | "buildSnapshotEvent" | "subscribeUiEvents";

type _TrustedWalletApiDoesNotExposeProtocolKeys = AssertNever<Extract<keyof TrustedWalletApi, WalletApiForbiddenKey>>;
