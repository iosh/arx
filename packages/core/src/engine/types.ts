import type { AccountCodec } from "../accounts/addressing/codec.js";
import type { AccountSelectionService, MultiNamespaceAccountsState } from "../accounts/runtime/types.js";
import type {
  ApprovalCreatedEvent,
  ApprovalCreateParams,
  ApprovalFinishedEvent,
  ApprovalHandle,
  ApprovalQueueKind,
  ApprovalQueueService,
  ApprovalRecord,
  ApprovalRequester,
  ApprovalResolveInput,
  ApprovalResolveResult,
  ApprovalState,
} from "../approvals/queue/types.js";
import type { ChainRef } from "../chains/ids.js";
import type { ChainMetadata, RpcEndpoint } from "../chains/metadata.js";
import type {
  AddSupportedChainOptions,
  AddSupportedChainResult,
  SupportedChainEntity,
  SupportedChainsUpdate,
} from "../chains/runtime/supportedChains/types.js";
import type { NetworkState, RpcOutcomeReport, RpcRoutingService, RpcStrategyConfig } from "../chains/runtime/types.js";
import type { ChainAddressCodec } from "../chains/types.js";
import type { NamespaceRuntimeManifest } from "../namespaces/types.js";
import type {
  PermissionAuthorization,
  PermissionsEvents,
  PermissionsReader,
  PermissionsState,
  PermissionsWriter,
} from "../permissions/service/types.js";
import type { RpcNamespaceModule } from "../rpc/namespaces/types.js";
import type {
  ConfirmNewMnemonicParams,
  ImportMnemonicParams,
  ImportPrivateKeyParams,
  KeyringService,
} from "../runtime/keyring/KeyringService.js";
import type { NamespaceConfig } from "../runtime/keyring/namespaces.js";
import type {
  ProviderConnectionStateChangedHandler,
  ProviderRuntimeConnectionQuery,
  ProviderRuntimeConnectionState,
  ProviderRuntimeRequestScope,
  ProviderRuntimeRpcError,
  ProviderRuntimeRpcRequest,
  ProviderRuntimeRpcResponse,
  ProviderRuntimeSnapshot,
} from "../runtime/provider/types.js";
import type {
  SessionLockState,
  UnlockLockedPayload,
  UnlockParams,
  UnlockReason,
  UnlockUnlockedPayload,
} from "../runtime/session/unlock/types.js";
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
import type { PermissionsPort } from "../services/store/permissions/port.js";
import type { ProviderChainSelectionPort } from "../services/store/providerChainSelection/port.js";
import type { SettingsPort } from "../services/store/settings/port.js";
import type { WalletChainSelectionPort } from "../services/store/walletChainSelection/port.js";
import type { WalletChainSelectionChangedHandler } from "../services/store/walletChainSelection/types.js";
import type { AccountRecord, KeyringMetaRecord, VaultMetaPort, VaultMetaSnapshot } from "../storage/index.js";
import type { WalletChainSelectionRecord } from "../storage/records.js";
import type { TransactionsStoragePort } from "../transactions/storage/index.js";
import type { UiEventEnvelope } from "../ui/protocol/envelopes.js";
import type { UiMethodName, UiMethodParams, UiMethodResult } from "../ui/protocol/index.js";
import type { ApprovalDetail } from "../ui/protocol/models/approvals.js";
import type { UiSnapshot } from "../ui/protocol/schemas.js";
import type { UiPlatformAdapter, UiServerExtension, UiWalletSnapshotReadModel } from "../ui/server/types.js";
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

/** Chain storage ports required to boot a wallet. */
export type CoreChainsStoragePorts = Readonly<{
  customChains: CustomChainsPort;
  customRpc: CustomRpcPort;
  walletChainSelection: WalletChainSelectionPort;
  providerChainSelection: ProviderChainSelectionPort;
}>;

/** Owner-scoped storage ports required to boot a wallet. */
export type CoreStoragePorts = Readonly<{
  vault: VaultMetaPort;
  keyrings: KeyringMetasPort;
  accounts: AccountsPort;
  permissions: PermissionsPort;
  chains: CoreChainsStoragePorts;
  transactions: TransactionsStoragePort;
  settings: SettingsPort;
}>;

/** Arguments for `createArxWallet()`. */
export type CreateArxWalletInput = Readonly<{
  namespaces: Readonly<{
    /** Modules to install. */
    modules: readonly WalletNamespaceModule[];
  }>;
  storage: Readonly<{
    /** Required storage ports. */
    ports: CoreStoragePorts;
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
  getSessionLockState(): SessionLockState;
  isUnlocked(): boolean;
  hasInitializedVault(): boolean;
  createVault(params: CreateVaultParams): Promise<VaultEnvelope>;
  importVault(envelope: VaultEnvelope): Promise<VaultEnvelope>;
  unlock(params: UnlockParams): Promise<SessionLockState>;
  lock(reason: UnlockReason): SessionLockState;
  resetAutoLockTimer(): SessionLockState;
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
  listOwnedForNamespace: AccountSelectionService["listOwnedForNamespace"];
  getOwnedAccount: AccountSelectionService["getOwnedAccount"];
  getAccountKeysForNamespace: AccountSelectionService["getAccountKeysForNamespace"];
  getSelectedAccountKey: AccountSelectionService["getSelectedAccountKey"];
  getActiveAccountForNamespace: AccountSelectionService["getActiveAccountForNamespace"];
  setActiveAccount: AccountSelectionService["setActiveAccount"];
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
  create<K extends ApprovalQueueKind>(
    request: ApprovalCreateParams<K>,
    requester: ApprovalRequester,
  ): ApprovalHandle<K>;
  resolve(input: ApprovalResolveInput): Promise<ApprovalResolveResult>;
  cancel: ApprovalQueueService["cancel"];
  onStateChanged: ApprovalQueueService["onStateChanged"];
  onCreated(listener: (event: ApprovalCreatedEvent) => void): () => void;
  onFinished(listener: (event: ApprovalFinishedEvent<unknown>) => void): () => void;
}>;

/** Persistent authorization facts stored by the permissions service. */
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
  getSelection(): Promise<WalletChainSelectionRecord | null>;
  getSelectionSnapshot(): WalletChainSelectionRecord | null;
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
  getActiveEndpoint: RpcRoutingService["getActiveEndpoint"];
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
  onSelectionChanged(listener: WalletChainSelectionChangedHandler): () => void;
  onChainUpdated(listener: (update: SupportedChainsUpdate) => void): () => void;
  onCustomRpcChanged(listener: CustomRpcChangedHandler): () => void;
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

/** Provider-facing connection state with the live connected bit. */
export type WalletProviderConnectionState = Readonly<
  ProviderRuntimeConnectionState & {
    connected: boolean;
  }
>;

/** Engine-owned provider contract for wallet shells. */
export type WalletProvider = Readonly<{
  getConnectionState(input: ProviderRuntimeConnectionQuery): Promise<WalletProviderConnectionState>;
  activateConnectionScope(input: ProviderRuntimeConnectionQuery): Promise<ProviderRuntimeConnectionState>;
  deactivateConnectionScope(input: ProviderRuntimeConnectionQuery): void;
  subscribeConnectionStateChanged(listener: ProviderConnectionStateChangedHandler): () => void;
  executeRpcRequest(request: ProviderRuntimeRpcRequest): Promise<ProviderRuntimeRpcResponse>;
  encodeRuntimeRpcError(error: unknown): ProviderRuntimeRpcError;
  cancelRequestScope(input: ProviderRuntimeRequestScope): Promise<number>;
  subscribeSessionUnlocked(listener: (payload: UnlockUnlockedPayload) => void): () => void;
  subscribeSessionLocked(listener: (payload: UnlockLockedPayload) => void): () => void;
}>;

/** Options for creating a wallet UI contract. */
export type WalletCreateUiOptions = Readonly<{
  platform: UiPlatformAdapter;
  uiOrigin: string;
  read?: UiWalletSnapshotReadModel;
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
  getDetail(approvalId: string): Promise<ApprovalDetail | null>;
}>;

/**
 * Live dApp connections kept only in memory.
 * Separate from persisted permissions and provider transport sessions.
 */
export type WalletDappConnections = Readonly<{
  getState(): DappConnectionsState;
  getConnection(origin: string, options: { namespace: string }): DappConnectionRecord | null;
  isConnected(origin: string, options: { namespace: string }): boolean;
  onStateChanged(listener: (state: DappConnectionsState) => void): () => void;
}>;

/** Provider and UI snapshot builders. */
export type WalletSnapshots = Readonly<{
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
