import type { AccountCodec } from "../accounts/addressing/codec.js";
import type { ChainRef } from "../chains/ids.js";
import type { ChainMetadata, RpcEndpoint } from "../chains/metadata.js";
import type { ChainAddressCodec } from "../chains/types.js";
import type { AccountController, MultiNamespaceAccountsState } from "../controllers/account/types.js";
import type {
  ApprovalController,
  ApprovalCreatedEvent,
  ApprovalCreateParams,
  ApprovalFinishedEvent,
  ApprovalHandle,
  ApprovalKind,
  ApprovalRecord,
  ApprovalRequester,
  ApprovalResolveInput,
  ApprovalResolveResult,
  ApprovalState,
} from "../controllers/approval/types.js";
import type {
  NetworkController,
  NetworkState,
  RpcOutcomeReport,
  RpcStrategyConfig,
} from "../controllers/network/types.js";
import type {
  PermissionAuthorization,
  PermissionsEvents,
  PermissionsReader,
  PermissionsState,
  PermissionsWriter,
} from "../controllers/permission/types.js";
import type {
  AddSupportedChainOptions,
  AddSupportedChainResult,
  SupportedChainEntity,
  SupportedChainsUpdate,
} from "../controllers/supportedChains/types.js";
import type { TransactionController } from "../controllers/transaction/types.js";
import type {
  UnlockLockedPayload,
  UnlockParams,
  UnlockReason,
  UnlockState,
  UnlockUnlockedPayload,
} from "../controllers/unlock/types.js";
import type { NamespaceRuntimeManifest } from "../namespaces/types.js";
import type { JsonRpcError, JsonRpcResponse } from "../rpc/index.js";
import type { RpcNamespaceModule } from "../rpc/namespaces/types.js";
import type {
  ConfirmNewMnemonicParams,
  ImportMnemonicParams,
  ImportPrivateKeyParams,
  KeyringService,
} from "../runtime/keyring/KeyringService.js";
import type { NamespaceConfig } from "../runtime/keyring/namespaces.js";
import type {
  ProviderRuntimeConnectionQuery,
  ProviderRuntimeConnectionState,
  ProviderRuntimeErrorContext,
  ProviderRuntimeRequestScope,
  ProviderRuntimeRpcRequest,
  ProviderRuntimeSnapshot,
} from "../runtime/provider/types.js";
import type { AttentionService } from "../services/runtime/attention/types.js";
import type { ActivateNamespaceChainParams } from "../services/runtime/chainActivation/types.js";
import type { ChainView, UiNetworksSnapshot } from "../services/runtime/chainViews/types.js";
import type { KeyringExportService } from "../services/runtime/keyringExport.js";
import type { SessionStatus } from "../services/runtime/sessionStatus.js";
import type { AccountsPort } from "../services/store/accounts/port.js";
import type { CustomChainsPort } from "../services/store/customChains/port.js";
import type { CustomRpcPort } from "../services/store/customRpc/port.js";
import type { CustomRpcChangedHandler } from "../services/store/customRpc/types.js";
import type { KeyringMetasPort } from "../services/store/keyringMetas/port.js";
import type { NetworkSelectionPort } from "../services/store/networkSelection/port.js";
import type { NetworkSelectionChangedHandler } from "../services/store/networkSelection/types.js";
import type { PermissionsPort } from "../services/store/permissions/port.js";
import type { SettingsPort } from "../services/store/settings/port.js";
import type { TransactionsPort } from "../services/store/transactions/port.js";
import type { AccountRecord, KeyringMetaRecord, VaultMetaPort, VaultMetaSnapshot } from "../storage/index.js";
import type { NetworkSelectionRecord } from "../storage/records.js";
import type { UiEventEnvelope } from "../ui/protocol/envelopes.js";
import type { UiMethodName, UiMethodParams, UiMethodResult } from "../ui/protocol/index.js";
import type { ApprovalDetail } from "../ui/protocol/models/approvals.js";
import type { UiSnapshot } from "../ui/protocol/schemas.js";
import type { UiPlatformAdapter, UiServerExtension } from "../ui/server/types.js";
import type { CreateVaultParams, VaultEnvelope } from "../vault/types.js";

// Static namespace description that can be indexed and validated before boot.
export type NamespaceEngineFacts = Readonly<{
  /** Namespace id. */
  namespace: string;
  /** RPC module. */
  rpc: RpcNamespaceModule;
  /** Chain-address codec. */
  chainAddressCodec: ChainAddressCodec;
  /** Account codec. */
  accountCodec: AccountCodec;
  /** Keyring config. */
  keyring: NamespaceConfig;
  /** Seed chains. */
  chainSeeds?: readonly ChainMetadata[];
}>;

// Runtime factories contributed by a namespace module to the wallet engine.
export type NamespaceEngineFactories = Readonly<{
  /** RPC client factory. */
  clientFactory?: NonNullable<NamespaceRuntimeManifest["clientFactory"]>;
  /** Signer factory. */
  createSigner?: NonNullable<NamespaceRuntimeManifest["createSigner"]>;
  /** Approval bindings factory. */
  createApprovalBindings?: NonNullable<NamespaceRuntimeManifest["createApprovalBindings"]>;
  /** UI bindings factory. */
  createUiBindings?: NonNullable<NamespaceRuntimeManifest["createUiBindings"]>;
  /** Namespace transaction factory. */
  createTransaction?: NonNullable<NamespaceRuntimeManifest["createTransaction"]>;
}>;

// Engine-facing namespace definition split into static facts and executable factories.
export type NamespaceEngineDefinition = Readonly<{
  /** Static namespace facts. */
  facts: NamespaceEngineFacts;
  /** Runtime factories. */
  factories?: NamespaceEngineFactories;
}>;

// Single installed engine namespace module.
export type WalletNamespaceModule = Readonly<{
  /** Namespace id. */
  namespace: string;
  /** Engine definition. */
  engine: NamespaceEngineDefinition;
}>;

// Read-only installed namespace collection available while the wallet is alive.
export type WalletNamespaces = Readonly<{
  /** Get a module by namespace. */
  findModule(namespace: string): WalletNamespaceModule | undefined;
  /** Get a module or throw. */
  requireModule(namespace: string): WalletNamespaceModule;
  /** List installed modules. */
  listModules(): WalletNamespaceModule[];
  /** List installed namespace ids. */
  listNamespaces(): string[];
}>;

/** Storage ports required to boot a wallet. */
export type ArxWalletStoragePorts = Readonly<{
  accounts: AccountsPort;
  customChains: CustomChainsPort;
  customRpc: CustomRpcPort;
  keyringMetas: KeyringMetasPort;
  networkSelection: NetworkSelectionPort;
  permissions: PermissionsPort;
  settings: SettingsPort;
  transactions: TransactionsPort;
}>;

/** Arguments for `createArxWallet()`. */
export type CreateArxWalletInput = Readonly<{
  namespaces: Readonly<{
    /** Modules to install. */
    modules: readonly WalletNamespaceModule[];
  }>;
  storage: Readonly<{
    /** Required storage ports. */
    ports: ArxWalletStoragePorts;
    /** Vault metadata port. */
    vaultMetaPort?: VaultMetaPort;
    /** Whether to hydrate persisted state. */
    hydrate?: boolean;
  }>;
  env?: Readonly<{
    /** Clock override. */
    now?: () => number;
    /** Logger hook. */
    logger?: (message: string, error?: unknown) => void;
    /** UUID source override. */
    randomUuid?: () => string;
  }>;
}>;

/** Vault lifecycle, unlock state, and auto-lock controls. */
export type WalletSession = Readonly<{
  getStatus(): SessionStatus;
  getUnlockState(): UnlockState;
  isUnlocked(): boolean;
  hasInitializedVault(): boolean;
  createVault(params: CreateVaultParams): Promise<VaultEnvelope>;
  importVault(envelope: VaultEnvelope): Promise<VaultEnvelope>;
  unlock(params: UnlockParams): Promise<UnlockState>;
  lock(reason: UnlockReason): UnlockState;
  resetAutoLockTimer(): UnlockState;
  setAutoLockDuration(durationMs: number): {
    autoLockDurationMs: number;
    nextAutoLockAt: number | null;
  };
  verifyPassword(password: string): Promise<void>;
  getVaultMetaState(): VaultMetaSnapshot["payload"];
  getLastPersistedVaultMeta(): VaultMetaSnapshot | null;
  persistVaultMeta(): Promise<void>;
  onStateChanged(listener: () => void): () => void;
  onUnlocked(listener: (payload: UnlockUnlockedPayload) => void): () => void;
  onLocked(listener: (payload: UnlockLockedPayload) => void): () => void;
}>;

/** HD backup reminder state derived from keyring metadata. */
export type WalletBackupStatus = Readonly<{
  pendingHdKeyringCount: number;
  nextHdKeyring: Readonly<{
    keyringId: string;
    alias: string | null;
  }> | null;
}>;

/** Wallet-setup projection derived from owned accounts. */
export type WalletSetupState = Readonly<{
  totalAccountCount: number;
  hasOwnedAccounts: boolean;
}>;

/** Accounts, keyrings, and related projections. */
export type WalletAccounts = Readonly<{
  getState(): MultiNamespaceAccountsState;
  listOwnedForNamespace: AccountController["listOwnedForNamespace"];
  getOwnedAccount: AccountController["getOwnedAccount"];
  getAccountKeysForNamespace: AccountController["getAccountKeysForNamespace"];
  getSelectedAccountKey: AccountController["getSelectedAccountKey"];
  getActiveAccountForNamespace: AccountController["getActiveAccountForNamespace"];
  setActiveAccount: AccountController["setActiveAccount"];
  generateMnemonic: KeyringService["generateMnemonic"];
  confirmNewMnemonic: (params: ConfirmNewMnemonicParams) => ReturnType<KeyringService["confirmNewMnemonic"]>;
  importMnemonic: (params: ImportMnemonicParams) => ReturnType<KeyringService["importMnemonic"]>;
  importPrivateKey: (params: ImportPrivateKeyParams) => ReturnType<KeyringService["importPrivateKey"]>;
  deriveAccount: KeyringService["deriveAccount"];
  exportMnemonic: KeyringExportService["exportMnemonic"];
  exportPrivateKeyByAccountKey: KeyringExportService["exportPrivateKeyByAccountKey"];
  hideHdAccount: KeyringService["hideHdAccount"];
  unhideHdAccount: KeyringService["unhideHdAccount"];
  renameKeyring: KeyringService["renameKeyring"];
  renameAccount: KeyringService["renameAccount"];
  markBackedUp: KeyringService["markBackedUp"];
  removePrivateKeyKeyring: KeyringService["removePrivateKeyKeyring"];
  getKeyrings(): KeyringMetaRecord[];
  getAccountsByKeyring(keyringId: string, includeHidden?: boolean): AccountRecord[];
  getBackupStatus(): WalletBackupStatus;
  getWalletSetupState(): WalletSetupState;
}>;

/** In-memory approvals and their stable read models. */
export type WalletApprovals = Readonly<{
  getState(): ApprovalState;
  get(id: string): ApprovalRecord | undefined;
  listPending(): ApprovalRecord[];
  create<K extends ApprovalKind>(request: ApprovalCreateParams<K>, requester: ApprovalRequester): ApprovalHandle<K>;
  resolve(input: ApprovalResolveInput): Promise<ApprovalResolveResult>;
  cancel: ApprovalController["cancel"];
  cancelByScope: ApprovalController["cancelByScope"];
  onStateChanged: ApprovalController["onStateChanged"];
  onCreated(listener: (event: ApprovalCreatedEvent) => void): () => void;
  onFinished(listener: (event: ApprovalFinishedEvent<unknown>) => void): () => void;
}>;

/** Persistent authorization facts owned by the permissions domain. */
export type WalletPermissions = Readonly<{
  getState(): PermissionsState;
  getAuthorization(origin: string, options: { namespace: string }): PermissionAuthorization | null;
  getChainAuthorization: PermissionsReader["getChainAuthorization"];
  listOriginPermissions(origin: string): PermissionAuthorization[];
  grantAuthorization: PermissionsWriter["grantAuthorization"];
  setChainAccountKeys: PermissionsWriter["setChainAccountKeys"];
  revokeChainAuthorization: PermissionsWriter["revokeChainAuthorization"];
  revokeNamespaceAuthorization: PermissionsWriter["revokeNamespaceAuthorization"];
  revokeOriginPermissions: PermissionsWriter["revokeOriginPermissions"];
  onStateChanged(listener: (state: PermissionsState) => void): () => void;
  onOriginChanged: PermissionsEvents["onOriginChanged"];
}>;

/** Selected namespace, supported chains, and custom RPC overrides. */
export type WalletNetworks = Readonly<{
  getSelection(): Promise<NetworkSelectionRecord | null>;
  getSelectionSnapshot(): NetworkSelectionRecord | null;
  getSelectedNamespace(): string;
  getChainRefByNamespace(): Record<string, ChainRef>;
  getSelectedChainRef(namespace: string): ChainRef | null;
  getChain(chainRef: ChainRef): SupportedChainEntity | null;
  listChains(): SupportedChainEntity[];
  getSelectedChainView(): ChainView;
  getActiveChainViewForNamespace(namespace: string): ChainView;
  listKnownChainViews(): ChainView[];
  listAvailableChainViews(): ChainView[];
  buildWalletNetworksSnapshot(): UiNetworksSnapshot;
  getNetworkState(): NetworkState;
  getRpcEndpoints(chainRef: ChainRef): RpcEndpoint[];
  getActiveEndpoint: NetworkController["getActiveEndpoint"];
  addChain(chain: ChainMetadata, options?: AddSupportedChainOptions): Promise<AddSupportedChainResult>;
  removeChain(chainRef: ChainRef): Promise<{ removed: boolean; previous?: SupportedChainEntity }>;
  setCustomRpc(chainRef: ChainRef, rpcEndpoints: RpcEndpoint[]): Promise<void>;
  clearCustomRpc(chainRef: ChainRef): Promise<void>;
  selectChain(chainRef: ChainRef): Promise<void>;
  selectNamespace(namespace: string): Promise<void>;
  activateNamespaceChain(params: ActivateNamespaceChainParams): Promise<void>;
  setRpcStrategy(chainRef: ChainRef, strategy: RpcStrategyConfig): void;
  reportRpcOutcome(chainRef: ChainRef, outcome: RpcOutcomeReport): void;
  onStateChanged(listener: (state: NetworkState) => void): () => void;
  onSelectionChanged(listener: NetworkSelectionChangedHandler): () => void;
  onChainUpdated(listener: (update: SupportedChainsUpdate) => void): () => void;
  onCustomRpcChanged(listener: CustomRpcChangedHandler): () => void;
}>;

/** Transaction approvals, execution, and status tracking. */
export type WalletTransactions = Readonly<{
  getMeta: TransactionController["getMeta"];
  beginTransactionApproval: TransactionController["beginTransactionApproval"];
  waitForTransactionSubmission: TransactionController["waitForTransactionSubmission"];
  approveTransaction: TransactionController["approveTransaction"];
  rejectTransaction: TransactionController["rejectTransaction"];
  processTransaction: TransactionController["processTransaction"];
  onStatusChanged: TransactionController["onStatusChanged"];
  onStateChanged: TransactionController["onStateChanged"];
}>;

/** Ephemeral prompts outside the approvals flow. */
export type WalletAttention = Readonly<{
  requestAttention: AttentionService["requestAttention"];
  getSnapshot: AttentionService["getSnapshot"];
  clear: AttentionService["clear"];
  clearExpired: AttentionService["clearExpired"];
}>;

/** One live dApp connection tracked in memory. */
export type DappConnectionRecord = Readonly<{
  origin: string;
  namespace: string;
  chainRef: ChainRef | null;
  connectedAt: number;
  updatedAt: number;
}>;

/** Current in-memory dApp connections. */
export type DappConnectionsState = Readonly<{
  connections: DappConnectionRecord[];
  count: number;
}>;

/** Provider-facing connection state plus the live connected bit. */
export type DappConnectionProjection = Readonly<
  ProviderRuntimeConnectionState & {
    connected: boolean;
  }
>;

/** Provider-facing connection projection with live connected state. */
export type WalletProviderConnectionProjection = DappConnectionProjection;

/** Engine-owned provider contract for wallet shells. */
export type WalletProvider = Readonly<{
  buildSnapshot(namespace: string): ProviderRuntimeSnapshot;
  buildConnectionProjection(input: ProviderRuntimeConnectionQuery): WalletProviderConnectionProjection;
  executeRpcRequest(request: ProviderRuntimeRpcRequest): Promise<JsonRpcResponse>;
  encodeRpcError(error: unknown, context: ProviderRuntimeErrorContext): JsonRpcError;
  connect(input: { origin: string; namespace: string }): WalletProviderConnectionProjection;
  disconnect(input: { origin: string; namespace: string }): WalletProviderConnectionProjection;
  disconnectOrigin(origin: string): number;
  cancelRequestScope(input: ProviderRuntimeRequestScope): Promise<number>;
  subscribeSessionUnlocked(listener: (payload: UnlockUnlockedPayload) => void): () => void;
  subscribeSessionLocked(listener: (payload: UnlockLockedPayload) => void): () => void;
  subscribeNetworkStateChanged(listener: () => void): () => void;
  subscribeNetworkSelectionChanged(listener: () => void): () => void;
  subscribeAccountsStateChanged(listener: () => void): () => void;
  subscribePermissionsStateChanged(listener: () => void): () => void;
}>;

/** Options for creating a wallet UI contract. */
export type WalletCreateUiOptions = Readonly<{
  platform: UiPlatformAdapter;
  uiOrigin: string;
  extensions?: readonly UiServerExtension[];
}>;

/** UI method dispatch input. */
export type WalletUiDispatchInput<M extends UiMethodName> =
  undefined extends UiMethodParams<M>
    ? Readonly<{
        method: M;
        params?: UiMethodParams<M>;
      }>
    : Readonly<{
        method: M;
        params: UiMethodParams<M>;
      }>;

/** Engine-owned UI contract for wallet shells. */
export type WalletUi = Readonly<{
  buildSnapshot(): UiSnapshot;
  dispatch<M extends UiMethodName>(input: WalletUiDispatchInput<M>): Promise<UiMethodResult<M>>;
  subscribeStateChanged(listener: () => void): () => void;
  subscribeUiEvents(listener: (event: UiEventEnvelope) => void): () => void;
}>;

/** Runtime-owned approval detail read model for shell bootstrap. */
export type WalletApprovalDetails = Readonly<{
  getDetail(approvalId: string): ApprovalDetail | null;
}>;

/**
 * Live dApp connections kept only in memory.
 * Separate from persisted permissions and provider transport sessions.
 */
export type WalletDappConnections = Readonly<{
  getState(): DappConnectionsState;
  getConnection(origin: string, options: { namespace: string }): DappConnectionRecord | null;
  isConnected(origin: string, options: { namespace: string }): boolean;
  connect(input: { origin: string; namespace: string }): DappConnectionRecord | null;
  disconnect(input: { origin: string; namespace: string }): boolean;
  disconnectOrigin(origin: string): number;
  clear(): DappConnectionsState;
  buildConnectionProjection(input: ProviderRuntimeConnectionQuery): DappConnectionProjection;
  listPermittedAccounts(input: { origin: string; chainRef: ChainRef }): string[];
  onStateChanged(listener: (state: DappConnectionsState) => void): () => void;
}>;

/** Provider and UI snapshot builders. */
export type WalletSnapshots = Readonly<{
  buildProviderSnapshot(namespace: string): ProviderRuntimeSnapshot;
  buildProviderConnectionState(input: ProviderRuntimeConnectionQuery): ProviderRuntimeConnectionState;
  buildUiSnapshot(): UiSnapshot;
}>;

export type ArxWallet = Readonly<{
  /** Installed namespace modules. */
  namespaces: WalletNamespaces;
  /** Wallet session methods. */
  session: WalletSession;
  /** Accounts, keyrings, and account projections. */
  accounts: WalletAccounts;
  /** In-memory approvals and approval read models. */
  approvals: WalletApprovals;
  /** Persistent permissions and derived views. */
  permissions: WalletPermissions;
  /** Network selection and preferences. */
  networks: WalletNetworks;
  /** Transaction approvals, execution, and status tracking. */
  transactions: WalletTransactions;
  /** Ephemeral prompts. */
  attention: WalletAttention;
  /** In-memory dApp connections. */
  dappConnections: WalletDappConnections;
  /** Create a provider-facing contract. */
  createProvider(): WalletProvider;
  /** Create a UI-facing contract. */
  createUi(options: WalletCreateUiOptions): WalletUi;
  /** Provider and UI snapshots. */
  snapshots: WalletSnapshots;
}>;
