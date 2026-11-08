import type { AccountGroupId } from "../accounts/accountGroupId.js";
import type { AccountId } from "../accounts/accountId.js";
import type { AccountGroup, AccountsChanged, Address } from "../accounts/types.js";
import type { Approval, ApprovalDecision, ApprovalId, ApprovalsChanged } from "../approvals/types.js";
import type { KeyringChanged, KeySource, KeySourceId } from "../keyring/types.js";
import type { Eip155Rpc } from "../namespaces/eip155/rpc.js";
import type { Namespace } from "../namespaces/types.js";
import type { ChainRef } from "../networks/chainRef.js";
import type {
  CustomNetworkInput,
  Network,
  NetworkRpcConfiguration,
  NetworksChanged,
  NonEmptyRpcEndpoints,
} from "../networks/types.js";
import type { Permission, PermissionsChanged } from "../permissions/Permissions.js";
import type { PermissionScope } from "../permissions/persistence.js";
import type { PreparedTransaction, WalletPrepareTransactionInput } from "../transactions/preparedTransaction.js";
import type { TransactionsChanged } from "../transactions/Transactions.js";
import type {
  Transaction,
  TransactionId,
  TransactionPage,
  TransactionQuery,
  TransactionReplacementType,
} from "../transactions/types.js";
import type {
  AddMnemonicAndMoveAccountInput,
  AddMnemonicSourceInput,
  AddMnemonicSourceResult,
  Bip39SourceAdded,
  Bip39WalletInitializationResult,
  CreateFromMnemonicInput,
  CreateFromPrivateKeyInput,
  HdAccountGroupCreationResult,
  ImportPrivateKeySourceResult,
  MovePrivateKeyAccountInput,
  PrivateKeySourceInput,
  PrivateKeyWalletInitializationResult,
  RestoreFromMnemonicInput,
  SetAccountGroupHiddenResult,
  WalletStatus,
  WalletStatusChanged,
} from "./Wallet.js";

export type WalletApiEvent =
  | WalletStatusChanged
  | KeyringChanged
  | AccountsChanged
  | NetworksChanged
  | PermissionsChanged
  | ApprovalsChanged
  | TransactionsChanged;

export type WalletKeySourcesApi = Readonly<{
  generateMnemonic(): Promise<{ mnemonic: string }>;
  get(keySourceId: KeySourceId): Promise<KeySource>;
  list(): Promise<readonly KeySource[]>;
  /** Saves the source and selects its first account atomically; other outcomes leave state unchanged. */
  addMnemonic(input: AddMnemonicSourceInput): Promise<AddMnemonicSourceResult>;
  /**
   * Adds the source and moves its existing private-key first account atomically.
   * Repeating a completed move returns its existing IDs without changing state.
   */
  addMnemonicAndMoveAccount(input: AddMnemonicAndMoveAccountInput): Promise<Bip39SourceAdded>;
  /** Saves and selects the account atomically; duplicates, including hidden accounts, leave state unchanged. */
  importPrivateKey(input: PrivateKeySourceInput): Promise<ImportPrivateKeySourceResult>;
  renameMnemonic(input: { keySourceId: KeySourceId; name: string }): Promise<void>;
  confirmMnemonicBackup(input: { keySourceId: KeySourceId }): Promise<void>;
  /** Requires an unlocked wallet. Returns null if the password does not match. */
  exportMnemonic(input: { keySourceId: KeySourceId; password: string }): Promise<{ mnemonic: string } | null>;
  /** Removes the source and its accounts atomically, then cancels their pending sign/transaction approvals. */
  remove(input: { keySourceId: KeySourceId }): Promise<void>;
}>;

export type WalletAccountsApi = Readonly<{
  getGroup(accountGroupId: AccountGroupId): Promise<AccountGroup>;
  getSelectedGroup(): Promise<AccountGroup>;
  listGroups(): Promise<readonly AccountGroup[]>;
  getGroupAddresses(input: { accountGroupId: AccountGroupId }): Promise<readonly Address[]>;
  /** Projects a public member identity; current EVM addresses do not require a saved group. */
  getMemberAddresses(input: { accountId: AccountId }): Promise<readonly Address[]>;
  /** Returns null if the private key is invalid for the requested namespace. */
  fromPrivateKey(input: { privateKey: string; namespace: Namespace }): Promise<{
    accountId: AccountId;
    namespace: Namespace;
    addresses: readonly Address[];
  } | null>;
  create(input: { keySourceId: KeySourceId }): Promise<HdAccountGroupCreationResult>;
  move(input: MovePrivateKeyAccountInput): Promise<AccountGroup>;
  /** Requires an unlocked wallet. Returns null for an incorrect password; derives or returns only this account's key. */
  exportPrivateKey(input: { accountId: AccountId; password: string }): Promise<{ privateKey: string } | null>;
  rename(input: { accountGroupId: AccountGroupId; alias?: string }): Promise<void>;
  /**
   * Keeps one visible group per recovery source and cancels all hidden members' pending sign/transaction approvals.
   * Restoring preserves selection and does not restore dapp grants.
   */
  setHidden(input: { accountGroupId: AccountGroupId; hidden: boolean }): Promise<SetAccountGroupHiddenResult>;
  select(input: { accountGroupId: AccountGroupId }): Promise<void>;
}>;

export type WalletNetworksApi = Readonly<{
  get(chainRef: ChainRef): Promise<Network | null>;
  list(): Promise<readonly Network[]>;
  listByNamespace(namespace: Namespace): Promise<readonly Network[]>;
  getRpcConfiguration(chainRef: ChainRef): Promise<NetworkRpcConfiguration>;
  addCustom(input: CustomNetworkInput): Promise<void>;
  updateCustom(input: CustomNetworkInput): Promise<void>;
  removeCustom(chainRef: ChainRef): Promise<void>;
  setRpcOverride(input: { chainRef: ChainRef; endpoints: NonEmptyRpcEndpoints }): Promise<void>;
  clearRpcOverride(chainRef: ChainRef): Promise<void>;
}>;

export type WalletPermissionsApi = Readonly<{
  get(scope: PermissionScope): Promise<Permission | null>;
  list(): Promise<readonly Permission[]>;
  listByOrigin(origin: string): Promise<readonly Permission[]>;
  setAccounts(input: Permission): Promise<void>;
  revoke(scope: PermissionScope): Promise<void>;
  disconnectOrigin(input: { origin: string }): Promise<void>;
}>;

export type WalletApprovalsApi = Readonly<{
  get(approvalId: ApprovalId): Promise<Approval>;
  list(): Promise<readonly Approval[]>;
  approve(decision: ApprovalDecision): Promise<void>;
  reject(approvalId: ApprovalId): Promise<void>;
}>;

export type WalletTransactionsApi = Readonly<{
  prepare(input: WalletPrepareTransactionInput): Promise<PreparedTransaction>;
  submit(prepared: PreparedTransaction): Promise<Transaction>;
  prepareReplacement(input: {
    transactionId: TransactionId;
    type: TransactionReplacementType;
  }): Promise<PreparedTransaction>;
  get(transactionId: TransactionId): Promise<Transaction | null>;
  list(query: TransactionQuery): Promise<TransactionPage>;
}>;

export type WalletApi = Readonly<{
  subscribe(listener: (event: WalletApiEvent) => void): () => void;

  getStatus(): Promise<WalletStatus>;
  createFromMnemonic(input: CreateFromMnemonicInput): Promise<Bip39WalletInitializationResult>;
  restoreFromMnemonic(input: RestoreFromMnemonicInput): Promise<Bip39WalletInitializationResult>;
  createFromPrivateKey(input: CreateFromPrivateKeyInput): Promise<PrivateKeyWalletInitializationResult>;
  /**
   * Returns false if the password does not match.
   * An already unlocked wallet returns true without checking the password.
   */
  unlock(input: { password: string }): Promise<boolean>;
  lock(): Promise<void>;
  changePassword(input: { currentPassword: string; newPassword: string }): Promise<void>;
  getAutoLockDuration(): Promise<number>;
  setAutoLockDuration(input: { durationMs: number }): Promise<void>;
  /** Notifies the wallet of authenticated first-party UI input; expired sessions stay locked. */
  notifyUserActivity(): Promise<void>;

  keySources: WalletKeySourcesApi;
  accounts: WalletAccountsApi;
  networks: WalletNetworksApi;
  eip155: Eip155Rpc;
  permissions: WalletPermissionsApi;
  approvals: WalletApprovalsApi;
  transactions: WalletTransactionsApi;
}>;
