import type { AccountId } from "../accounts/accountId.js";
import type { Account, AccountAddress, AccountsChanged } from "../accounts/types.js";
import type { Approval, ApprovalDecision, ApprovalId, ApprovalsChanged } from "../approvals/types.js";
import type { JsonRpcParams } from "../chainJsonRpc/types.js";
import type { HdKeyring, HdKeyringId, KeyringChanged, KeySource, KeySourceId } from "../keyring/types.js";
import type { Namespace } from "../namespaces/types.js";
import type { ChainRef } from "../networks/chainRef.js";
import type {
  CustomNetworkInput,
  Network,
  NetworkRpcConfiguration,
  NetworkSelection,
  NetworkSelectionChanged,
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
  AddHdKeyringInput,
  Bip39SourceAdded,
  Bip39WalletCreated,
  CreateFromMnemonicInput,
  CreateFromPrivateKeyInput,
  MnemonicSourceInput,
  PrivateKeySourceAdded,
  PrivateKeySourceInput,
  PrivateKeyWalletCreated,
  RestoreFromMnemonicInput,
  WalletStatus,
  WalletStatusChanged,
} from "./Wallet.js";

export type WalletApiEvent =
  | WalletStatusChanged
  | KeyringChanged
  | AccountsChanged
  | NetworksChanged
  | NetworkSelectionChanged
  | PermissionsChanged
  | ApprovalsChanged
  | TransactionsChanged;

export type WalletKeySourcesApi = Readonly<{
  generateMnemonic(): Promise<{ mnemonic: string }>;
  get(keySourceId: KeySourceId): Promise<KeySource>;
  list(): Promise<readonly KeySource[]>;
  addMnemonic(input: MnemonicSourceInput): Promise<Bip39SourceAdded>;
  importMnemonic(input: MnemonicSourceInput): Promise<Bip39SourceAdded>;
  importPrivateKey(input: PrivateKeySourceInput): Promise<PrivateKeySourceAdded>;
  confirmMnemonicBackup(input: { keySourceId: KeySourceId }): Promise<void>;
  exportMnemonic(input: { keySourceId: KeySourceId; password: string }): Promise<{ mnemonic: string }>;
  exportPrivateKey(input: { keySourceId: KeySourceId; password: string }): Promise<{ privateKey: string }>;
  remove(input: { keySourceId: KeySourceId }): Promise<void>;
}>;

export type WalletHdKeyringsApi = Readonly<{
  get(hdKeyringId: HdKeyringId): Promise<HdKeyring>;
  list(): Promise<readonly HdKeyring[]>;
  add(input: AddHdKeyringInput): Promise<{ hdKeyringId: HdKeyringId; accountId: AccountId }>;
  deriveAccount(input: { hdKeyringId: HdKeyringId }): Promise<AccountId>;
  remove(input: { hdKeyringId: HdKeyringId }): Promise<void>;
}>;

export type WalletAccountsApi = Readonly<{
  get(accountId: AccountId): Promise<Account>;
  list(): Promise<readonly Account[]>;
  getAddress(input: { accountId: AccountId; chainRef: ChainRef }): Promise<AccountAddress>;
  listAddresses(chainRef: ChainRef): Promise<readonly AccountAddress[]>;
  rename(input: { accountId: AccountId; alias?: string }): Promise<void>;
  setHidden(input: { accountId: AccountId; hidden: boolean }): Promise<void>;
  select(input: { accountId: AccountId }): Promise<void>;
}>;

export type WalletNetworksApi = Readonly<{
  get(chainRef: ChainRef): Promise<Network | null>;
  list(): Promise<readonly Network[]>;
  listByNamespace(namespace: Namespace): Promise<readonly Network[]>;
  getSelection(): Promise<NetworkSelection>;
  getRpcConfiguration(chainRef: ChainRef): Promise<NetworkRpcConfiguration>;
  addCustom(input: CustomNetworkInput): Promise<void>;
  updateCustom(input: CustomNetworkInput): Promise<void>;
  removeCustom(chainRef: ChainRef): Promise<void>;
  setRpcOverride(input: { chainRef: ChainRef; endpoints: NonEmptyRpcEndpoints }): Promise<void>;
  clearRpcOverride(chainRef: ChainRef): Promise<void>;
  selectNetwork(chainRef: ChainRef): Promise<void>;
  selectNamespace(namespace: Namespace): Promise<void>;
}>;

export type WalletChainRpcRequest = Readonly<{
  chainRef: ChainRef;
  method: string;
  params?: JsonRpcParams;
}>;

export type WalletChainRpcApi = Readonly<{
  request<TResult = unknown>(input: WalletChainRpcRequest): Promise<TResult>;
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
  createFromMnemonic(input: CreateFromMnemonicInput): Promise<Bip39WalletCreated>;
  restoreFromMnemonic(input: RestoreFromMnemonicInput): Promise<Bip39WalletCreated>;
  createFromPrivateKey(input: CreateFromPrivateKeyInput): Promise<PrivateKeyWalletCreated>;
  unlock(input: { password: string }): Promise<void>;
  lock(): Promise<void>;
  changePassword(input: { currentPassword: string; newPassword: string }): Promise<void>;
  getAutoLockDuration(): Promise<number>;
  setAutoLockDuration(input: { durationMs: number }): Promise<void>;

  keySources: WalletKeySourcesApi;
  hdKeyrings: WalletHdKeyringsApi;
  accounts: WalletAccountsApi;
  networks: WalletNetworksApi;
  chainRpc: WalletChainRpcApi;
  permissions: WalletPermissionsApi;
  approvals: WalletApprovalsApi;
  transactions: WalletTransactionsApi;
}>;
