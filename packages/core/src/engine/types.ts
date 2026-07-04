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
import type { ChainDefinition, RpcEndpoint } from "../chains/definition.js";
import type { ChainRef } from "../chains/ids.js";
import type { ChainRpcState } from "../chains/rpc/types.js";
import type {
  ChainDefinitionsUpdate,
  ChainDefinitionsUpsertCustomOptions,
  ChainDefinitionsUpsertCustomResult,
} from "../chains/runtime/chainDefinitions/types.js";
import type { NamespaceManifest } from "../namespaces/types.js";
import type {
  PermissionAuthorization,
  PermissionsEvents,
  PermissionsReader,
  PermissionsState,
  PermissionsWriter,
} from "../permissions/service/types.js";
import type {
  ConfirmNewMnemonicParams,
  ImportMnemonicParams,
  ImportPrivateKeyParams,
  KeyringService,
} from "../runtime/keyring/KeyringService.js";
import type {
  ProviderConnectionStateChangedHandler,
  ProviderRequestInput,
  ProviderRuntimeConnectionQuery,
  ProviderRuntimeConnectionState,
  ProviderRuntimeRequestScope,
  ProviderRuntimeRpcError,
  ProviderRuntimeRpcResponse,
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
import type { ChainView, NetworksSnapshot } from "../services/runtime/chainViews/types.js";
import type { KeyringExportService } from "../services/runtime/keyringExport.js";
import type { SessionStatus } from "../services/runtime/sessionStatus.js";
import type { AccountsPort } from "../services/store/accounts/port.js";
import type { ChainDefinitionsPort } from "../services/store/chainDefinitions/port.js";
import type { ChainRpcDefaultEndpointsPort } from "../services/store/chainRpcDefaultEndpoints/port.js";
import type { ChainRpcEndpointOverridesPort } from "../services/store/chainRpcEndpointOverrides/port.js";
import type { ChainRpcEndpointOverridesChangedHandler } from "../services/store/chainRpcEndpointOverrides/types.js";
import type { KeyringMetasPort } from "../services/store/keyringMetas/port.js";
import type { PermissionsPort } from "../services/store/permissions/port.js";
import type { ProviderChainSelectionPort } from "../services/store/providerChainSelection/port.js";
import type { SettingsPort } from "../services/store/settings/port.js";
import type { WalletChainSelectionPort } from "../services/store/walletChainSelection/port.js";
import type { WalletChainSelectionChangedHandler } from "../services/store/walletChainSelection/types.js";
import type {
  AccountRecord,
  ChainDefinitionEntity,
  KeyringMetaRecord,
  VaultMetaPort,
  VaultMetaSnapshot,
} from "../storage/index.js";
import type { WalletChainSelectionRecord } from "../storage/records.js";
import type { TransactionsStoragePort } from "../transactions/storage/index.js";
import type { CreateVaultParams, VaultEnvelope } from "../vault/types.js";
import type { WalletSetupWorkflow } from "../wallet/actions/setupWorkflow.js";
import type { WalletApiApprovalDetailResult, WalletApiPendingApprovalsResult } from "../wallet/types.js";

export type WalletNamespaces = Readonly<{
  findManifest(namespace: string): NamespaceManifest | undefined;
  requireManifest(namespace: string): NamespaceManifest;
  listManifests(): NamespaceManifest[];
  listNamespaces(): string[];
}>;

/** Chain storage ports required to boot a wallet. */
export type CoreChainsStoragePorts = Readonly<{
  chainDefinitions: ChainDefinitionsPort;
  chainRpcDefaultEndpoints: ChainRpcDefaultEndpointsPort;
  chainRpcEndpointOverrides: ChainRpcEndpointOverridesPort;
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
    /** Namespace manifests to install. */
    manifests: readonly NamespaceManifest[];
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
  getAccountIdsForNamespace: AccountSelectionService["getAccountIdsForNamespace"];
  getSelectedAccountId: AccountSelectionService["getSelectedAccountId"];
  getActiveAccountForNamespace: AccountSelectionService["getActiveAccountForNamespace"];
  setActiveAccount: AccountSelectionService["setActiveAccount"];
  generateMnemonic: KeyringService["generateMnemonic"];
  confirmNewMnemonic: (params: ConfirmNewMnemonicParams) => ReturnType<KeyringService["confirmNewMnemonic"]>;
  importMnemonic: (params: ImportMnemonicParams) => ReturnType<KeyringService["importMnemonic"]>;
  importPrivateKey: (params: ImportPrivateKeyParams) => ReturnType<KeyringService["importPrivateKey"]>;
  deriveAccount: KeyringService["deriveAccount"];
  exportMnemonic: KeyringExportService["exportMnemonic"];
  exportPrivateKeyByAccountId: KeyringExportService["exportPrivateKeyByAccountId"];
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
  setChainAccountIds: PermissionsWriter["setChainAccountIds"];
  revokeChainAuthorization: PermissionsWriter["revokeChainAuthorization"];
  revokeNamespaceAuthorization: PermissionsWriter["revokeNamespaceAuthorization"];
  revokeOriginPermissions: PermissionsWriter["revokeOriginPermissions"];
  onStateChanged(listener: (state: PermissionsState) => void): () => void;
  onOriginChanged: PermissionsEvents["onOriginChanged"];
}>;

/** Selected namespace, supported chains, and chain RPC controls. */
export type WalletNetworks = Readonly<{
  getSelection(): Promise<WalletChainSelectionRecord | null>;
  getSelectionSnapshot(): WalletChainSelectionRecord | null;
  getSelectedNamespace(): string;
  getChainRefByNamespace(): Record<string, ChainRef>;
  getSelectedChainRef(namespace: string): ChainRef | null;
  getChain(chainRef: ChainRef): ChainDefinitionEntity | null;
  listChains(): ChainDefinitionEntity[];
  getSelectedChainView(): ChainView;
  findAvailableChainView(params: { chainRef?: ChainRef; namespace?: string }): ChainView | null;
  getActiveChainViewForNamespace(namespace: string): ChainView;
  listKnownChainViews(): ChainView[];
  listAvailableChainViews(): ChainView[];
  buildWalletNetworksSnapshot(): NetworksSnapshot;
  getChainRpcState(): ChainRpcState;
  getRpcEndpoints(chainRef: ChainRef): RpcEndpoint[];
  addChain(
    chain: ChainDefinition,
    options?: ChainDefinitionsUpsertCustomOptions,
  ): Promise<ChainDefinitionsUpsertCustomResult>;
  removeChain(chainRef: ChainRef): Promise<{ removed: boolean; previous?: ChainDefinitionEntity }>;
  setChainRpcEndpointOverride(chainRef: ChainRef, rpcEndpoints: RpcEndpoint[]): Promise<void>;
  clearChainRpcEndpointOverride(chainRef: ChainRef): Promise<void>;
  selectChain(chainRef: ChainRef): Promise<void>;
  selectNamespace(namespace: string): Promise<void>;
  activateNamespaceChain(params: ActivateNamespaceChainParams): Promise<void>;
  onStateChanged(listener: (state: ChainRpcState) => void): () => void;
  onSelectionChanged(listener: WalletChainSelectionChangedHandler): () => void;
  onChainUpdated(listener: (update: ChainDefinitionsUpdate) => void): () => void;
  onChainRpcEndpointOverridesChanged(listener: ChainRpcEndpointOverridesChangedHandler): () => void;
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
  request(input: ProviderRequestInput): Promise<ProviderRuntimeRpcResponse>;
  encodeRuntimeRpcError(error: unknown): ProviderRuntimeRpcError;
  cancelRequestScope(input: ProviderRuntimeRequestScope): Promise<number>;
  subscribeSessionUnlocked(listener: (payload: UnlockUnlockedPayload) => void): () => void;
  subscribeSessionLocked(listener: (payload: UnlockLockedPayload) => void): () => void;
}>;

/** Runtime-owned approval access. */
export type WalletApprovalDetails = Readonly<{
  listPending(): Promise<WalletApiPendingApprovalsResult>;
  getDetail(approvalId: string): Promise<WalletApiApprovalDetailResult>;
}>;

export type WalletSetupServices = Readonly<{
  workflow: WalletSetupWorkflow;
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

export type ArxWallet = Readonly<{
  /** Installed namespace manifests. */
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
}>;
