import type { AccountsPort } from "../accounts/accountsPort.js";
import type { AccountSelectionService, MultiNamespaceAccountsState } from "../accounts/selection/types.js";
import type {
  ApprovalCreatedEvent,
  ApprovalCreateParams,
  ApprovalFinishedEvent,
  ApprovalHandle,
  ApprovalKind,
  ApprovalQueueService,
  ApprovalRecord,
  ApprovalRequester,
  ApprovalResolveInput,
  ApprovalResolveResult,
  ApprovalState,
} from "../approvals/queue/types.js";
import type { ActivateNamespaceChainParams } from "../chains/activation/types.js";
import type { ChainDefinition, RpcEndpoint } from "../chains/definition.js";
import type { ChainDefinitionsPort } from "../chains/definitions/port.js";
import type {
  ChainDefinitionsUpdate,
  ChainDefinitionsUpsertCustomOptions,
  ChainDefinitionsUpsertCustomResult,
} from "../chains/definitions/types.js";
import type { ChainRef } from "../chains/ids.js";
import type { ChainRpcDefaultEndpointsPort } from "../chains/rpc/defaultEndpoints/port.js";
import type { ChainRpcEndpointOverridesPort } from "../chains/rpc/endpointOverrides/port.js";
import type { ChainRpcEndpointOverridesChangedHandler } from "../chains/rpc/endpointOverrides/types.js";
import type { ChainRpcState } from "../chains/rpc/types.js";
import type { ProviderChainSelectionPort } from "../chains/selection/provider/port.js";
import type { WalletChainSelectionPort } from "../chains/selection/wallet/port.js";
import type { WalletChainSelectionChangedHandler } from "../chains/selection/wallet/types.js";
import type { ChainView, NetworksSnapshot } from "../chains/views/types.js";
import type { KeyringMetasPort } from "../keyring/keyringMetasPort.js";
import type {
  ConfirmNewMnemonicParams,
  ImportMnemonicParams,
  ImportPrivateKeyParams,
  KeyringService,
} from "../keyring/service/KeyringService.js";
import type { NamespaceManifest } from "../namespaces/types.js";
import type { PermissionsPort } from "../permissions/service/port.js";
import type {
  PermissionAuthorization,
  PermissionsEvents,
  PermissionsReader,
  PermissionsState,
  PermissionsWriter,
} from "../permissions/service/types.js";
import type {
  ProviderConnectionQuery,
  ProviderConnectionState,
  ProviderConnectionStateChangedHandler,
  ProviderRequestInput,
  ProviderRequestScope,
  ProviderRpcError,
  ProviderRpcResponse,
} from "../provider/access/types.js";
import type { SessionStatus } from "../session/sessionLayer.js";
import type {
  SessionLockState,
  UnlockLockedPayload,
  UnlockParams,
  UnlockReason,
  UnlockUnlockedPayload,
} from "../session/unlock/types.js";
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
import type { AttentionService } from "../wallet/attention/types.js";

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
  exportMnemonic: KeyringService["exportMnemonic"];
  exportPrivateKeyByAccountId: KeyringService["exportPrivateKeyByAccountId"];
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
  create<K extends ApprovalKind>(request: ApprovalCreateParams<K>, requester: ApprovalRequester): ApprovalHandle;
  resolve(input: ApprovalResolveInput): Promise<ApprovalResolveResult>;
  cancel: ApprovalQueueService["cancel"];
  onStateChanged: ApprovalQueueService["onStateChanged"];
  onCreated(listener: (event: ApprovalCreatedEvent) => void): () => void;
  onFinished(listener: (event: ApprovalFinishedEvent) => void): () => void;
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
  ProviderConnectionState & {
    connected: boolean;
  }
>;

/** Engine-owned provider contract for wallet shells. */
export type WalletProvider = Readonly<{
  getConnectionState(input: ProviderConnectionQuery): Promise<WalletProviderConnectionState>;
  activateConnectionScope(input: ProviderConnectionQuery): Promise<ProviderConnectionState>;
  deactivateConnectionScope(input: ProviderConnectionQuery): void;
  subscribeConnectionStateChanged(listener: ProviderConnectionStateChangedHandler): () => void;
  request(input: ProviderRequestInput): Promise<ProviderRpcResponse>;
  encodeRpcError(error: unknown): ProviderRpcError;
  cancelRequestScope(input: ProviderRequestScope): Promise<number>;
  subscribeSessionUnlocked(listener: (payload: UnlockUnlockedPayload) => void): () => void;
  subscribeSessionLocked(listener: (payload: UnlockLockedPayload) => void): () => void;
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
