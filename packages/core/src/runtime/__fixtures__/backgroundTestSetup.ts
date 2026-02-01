import type { JsonRpcEngine } from "@metamask/json-rpc-engine";
import type { JsonRpcParams, JsonRpcRequest } from "@metamask/utils";
import { vi } from "vitest";
import { DEFAULT_CHAIN_METADATA } from "../../chains/chains.seed.js";
import type { ChainRef } from "../../chains/ids.js";
import type { ChainMetadata } from "../../chains/metadata.js";
import type { ChainRegistryPort } from "../../chains/registryPort.js";
import type {
  AccountRecord,
  ApprovalRecord,
  KeyringMetaRecord,
  PermissionRecord,
  SettingsRecord,
  TransactionRecord,
} from "../../db/records.js";
import {
  AccountRecordSchema,
  KeyringMetaRecordSchema,
  PermissionRecordSchema,
  TransactionRecordSchema,
} from "../../db/records.js";
import { createMethodNamespaceResolver, encodeErrorWithAdapters, type RpcInvocationContext } from "../../rpc/index.js";
import type { AccountsPort } from "../../services/accounts/port.js";
import type { ApprovalsPort } from "../../services/approvals/port.js";
import type { KeyringMetasPort } from "../../services/keyringMetas/port.js";
import type { PermissionsPort } from "../../services/permissions/port.js";
import type { SettingsPort } from "../../services/settings/port.js";
import type { TransactionsPort } from "../../services/transactions/port.js";
import type {
  ChainRegistryEntity,
  NetworkSnapshot,
  PermissionsSnapshot,
  StorageNamespace,
  StoragePort,
  StorageSnapshotMap,
  TransactionsSnapshot,
  VaultMetaSnapshot,
} from "../../storage/index.js";
import {
  CHAIN_REGISTRY_ENTITY_SCHEMA_VERSION,
  NETWORK_SNAPSHOT_VERSION,
  PERMISSIONS_SNAPSHOT_VERSION,
  StorageNamespaces,
  TRANSACTIONS_SNAPSHOT_VERSION,
} from "../../storage/index.js";
import type { VaultCiphertext, VaultService } from "../../vault/types.js";
import { createRpcEngineForBackground } from "../background/rpcEngineAssembly.js";
import { type CreateBackgroundServicesOptions, createBackgroundServices } from "../createBackgroundServices.js";

// Test constants
export const TEST_MNEMONIC = "test test test test test test test test test test test junk";
export const TEST_AUTO_LOCK_DURATION = 1_000;
export const TEST_INITIAL_TIME = 5_000;
export const TEST_RECEIPT_POLL_INTERVAL = 3_000;
export const TEST_RECEIPT_MAX_DELAY = 30_000;

// Utility types
export type RpcTimers = {
  setTimeout?: typeof setTimeout;
  clearTimeout?: typeof clearTimeout;
};

export type CreateBackgroundServicesResult = ReturnType<typeof createBackgroundServices>;

export type StorageSeed = Partial<Record<StorageNamespace, StorageSnapshotMap[StorageNamespace]>>;

export type SnapshotEntry = {
  namespace: StorageNamespace;
  envelope: StorageSnapshotMap[StorageNamespace];
};

// Utility functions
export const clone = <T>(value: T): T => structuredClone(value);

export class MemorySettingsPort implements SettingsPort {
  #record: SettingsRecord | null;
  public readonly saved: SettingsRecord[] = [];

  constructor(seed: SettingsRecord | null = null) {
    this.#record = seed ? clone(seed) : null;
  }

  async get(): Promise<SettingsRecord | null> {
    return this.#record ? clone(this.#record) : null;
  }

  async put(record: SettingsRecord): Promise<void> {
    this.#record = clone(record);
    this.saved.push(clone(record));
  }
}

export class MemoryApprovalsPort implements ApprovalsPort {
  #records = new Map<string, ApprovalRecord>();

  async get(id: ApprovalRecord["id"]): Promise<ApprovalRecord | null> {
    const found = this.#records.get(id);
    return found ? clone(found) : null;
  }

  async listPending(): Promise<ApprovalRecord[]> {
    return Array.from(this.#records.values())
      .filter((record) => record.status === "pending")
      .map((record) => clone(record));
  }

  async upsert(record: ApprovalRecord): Promise<void> {
    this.#records.set(record.id, clone(record));
  }
}

export class MemoryPermissionsPort implements PermissionsPort {
  #records = new Map<string, PermissionRecord>();

  constructor(seed: PermissionRecord[] = []) {
    for (const record of seed) {
      const checked = PermissionRecordSchema.parse(record);
      this.#records.set(checked.id, clone(checked));
    }
  }

  async get(id: PermissionRecord["id"]): Promise<PermissionRecord | null> {
    const found = this.#records.get(id);
    return found ? clone(found) : null;
  }

  async listAll(): Promise<PermissionRecord[]> {
    return Array.from(this.#records.values()).map((record) => clone(record));
  }

  async getByOrigin(params: { origin: string; namespace: string; chainRef: string }): Promise<PermissionRecord | null> {
    for (const record of this.#records.values()) {
      if (record.origin !== params.origin) continue;
      if (record.namespace !== params.namespace) continue;
      if (record.chainRef !== params.chainRef) continue;
      return clone(record);
    }
    return null;
  }

  async listByOrigin(origin: string): Promise<PermissionRecord[]> {
    return Array.from(this.#records.values())
      .filter((record) => record.origin === origin)
      .map((record) => clone(record));
  }

  async upsert(record: PermissionRecord): Promise<void> {
    const checked = PermissionRecordSchema.parse(record);
    this.#records.set(checked.id, clone(checked));
  }

  async remove(id: PermissionRecord["id"]): Promise<void> {
    this.#records.delete(id);
  }

  async clearOrigin(origin: string): Promise<void> {
    for (const [id, record] of this.#records.entries()) {
      if (record.origin === origin) {
        this.#records.delete(id);
      }
    }
  }
}

export class MemoryTransactionsPort implements TransactionsPort {
  #records = new Map<string, TransactionRecord>();

  constructor(seed: TransactionRecord[] = []) {
    for (const record of seed) {
      const checked = TransactionRecordSchema.parse(record);
      this.#records.set(checked.id, clone(checked));
    }
  }

  async get(id: TransactionRecord["id"]): Promise<TransactionRecord | null> {
    const found = this.#records.get(id);
    return found ? clone(found) : null;
  }

  async list(query?: {
    chainRef?: string;
    status?: TransactionRecord["status"];
    limit?: number;
    beforeCreatedAt?: number;
  }): Promise<TransactionRecord[]> {
    const chainRef = query?.chainRef;
    const status = query?.status;
    const limit = query?.limit ?? 100;
    const beforeCreatedAt = query?.beforeCreatedAt;

    let all = Array.from(this.#records.values());
    if (chainRef !== undefined) all = all.filter((r) => r.chainRef === chainRef);
    if (status !== undefined) all = all.filter((r) => r.status === status);
    if (beforeCreatedAt !== undefined) all = all.filter((r) => r.createdAt < beforeCreatedAt);

    all.sort((a, b) => b.createdAt - a.createdAt);
    return all.slice(0, limit).map((r) => clone(r));
  }

  async findByChainRefAndHash(params: { chainRef: string; hash: string }): Promise<TransactionRecord | null> {
    for (const record of this.#records.values()) {
      if (record.chainRef !== params.chainRef) continue;
      if (record.hash !== params.hash) continue;
      return clone(record);
    }
    return null;
  }

  async upsert(record: TransactionRecord): Promise<void> {
    const checked = TransactionRecordSchema.parse(record);
    this.#records.set(checked.id, clone(checked));
  }

  async updateIfStatus(params: {
    id: TransactionRecord["id"];
    expectedStatus: TransactionRecord["status"];
    next: TransactionRecord;
  }): Promise<boolean> {
    const current = this.#records.get(params.id);
    if (!current) return false;
    if (current.status !== params.expectedStatus) return false;

    const checked = TransactionRecordSchema.parse(params.next);
    this.#records.set(checked.id, clone(checked));
    return true;
  }

  async remove(id: TransactionRecord["id"]): Promise<void> {
    this.#records.delete(id);
  }
}

export class MemoryAccountsPort implements AccountsPort {
  #records = new Map<string, AccountRecord>();

  constructor(seed: AccountRecord[] = []) {
    for (const record of seed) {
      const checked = AccountRecordSchema.parse(record);
      this.#records.set(checked.accountId, clone(checked));
    }
  }

  async get(accountId: string): Promise<AccountRecord | null> {
    const found = this.#records.get(accountId);
    return found ? clone(found) : null;
  }

  async list(): Promise<AccountRecord[]> {
    return Array.from(this.#records.values())
      .map((record) => clone(record))
      .sort((a, b) => a.createdAt - b.createdAt || a.accountId.localeCompare(b.accountId));
  }

  async upsert(record: AccountRecord): Promise<void> {
    const checked = AccountRecordSchema.parse(record);
    this.#records.set(checked.accountId, clone(checked));
  }

  async remove(accountId: string): Promise<void> {
    this.#records.delete(accountId);
  }

  async removeByKeyringId(keyringId: string): Promise<void> {
    for (const [accountId, record] of Array.from(this.#records.entries())) {
      if (record.keyringId === keyringId) {
        this.#records.delete(accountId);
      }
    }
  }
}

export class MemoryKeyringMetasPort implements KeyringMetasPort {
  #records = new Map<string, KeyringMetaRecord>();

  constructor(seed: KeyringMetaRecord[] = []) {
    for (const record of seed) {
      const checked = KeyringMetaRecordSchema.parse(record);
      this.#records.set(checked.id, clone(checked));
    }
  }

  async get(id: string): Promise<KeyringMetaRecord | null> {
    const found = this.#records.get(id);
    return found ? clone(found) : null;
  }

  async list(): Promise<KeyringMetaRecord[]> {
    return Array.from(this.#records.values())
      .map((record) => clone(record))
      .sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id));
  }

  async upsert(record: KeyringMetaRecord): Promise<void> {
    const checked = KeyringMetaRecordSchema.parse(record);
    this.#records.set(checked.id, clone(checked));
  }

  async remove(id: string): Promise<void> {
    this.#records.delete(id);
  }
}

export const baseChainMetadata = DEFAULT_CHAIN_METADATA[0]! as ChainMetadata;

export const flushAsync = async () => {
  await Promise.resolve();
  await Promise.resolve();
};

export const isNetworkSnapshot = (
  entry: SnapshotEntry,
): entry is { namespace: typeof StorageNamespaces.Network; envelope: NetworkSnapshot } =>
  entry.namespace === StorageNamespaces.Network;

export const isTransactionsSnapshot = (
  entry: SnapshotEntry,
): entry is { namespace: typeof StorageNamespaces.Transactions; envelope: TransactionsSnapshot } =>
  entry.namespace === StorageNamespaces.Transactions;

export const buildRpcSnapshot = (metadata: ChainMetadata) => ({
  activeIndex: 0,
  endpoints: metadata.rpcEndpoints.map((endpoint, index) => ({
    index,
    url: endpoint.url,
    type: endpoint.type ?? "public",
    weight: endpoint.weight,
    headers: endpoint.headers ? { ...endpoint.headers } : undefined,
  })),
  health: metadata.rpcEndpoints.map((_, index) => ({
    index,
    successCount: 0,
    failureCount: 0,
    consecutiveFailures: 0,
    lastError: undefined,
    lastFailureAt: undefined,
    cooldownUntil: undefined,
  })),
  strategy: { id: "round-robin" },
  lastUpdatedAt: 0,
});

/**
 * Produces minimal chain metadata for tests while allowing selective overrides.
 */
export const createChainMetadata = (overrides: Partial<ChainMetadata> = {}): ChainMetadata => {
  const metadata: ChainMetadata = {
    chainRef: overrides.chainRef ?? baseChainMetadata.chainRef,
    namespace: overrides.namespace ?? baseChainMetadata.namespace,
    chainId: overrides.chainId ?? baseChainMetadata.chainId,
    displayName: overrides.displayName ?? baseChainMetadata.displayName,
    shortName: overrides.shortName ?? baseChainMetadata.shortName,
    description: overrides.description ?? baseChainMetadata.description,
    nativeCurrency: overrides.nativeCurrency ?? clone(baseChainMetadata.nativeCurrency),
    rpcEndpoints: overrides.rpcEndpoints ?? [
      {
        url: `https://rpc.${(overrides.chainRef ?? baseChainMetadata.chainRef).replace(":", "-")}.example`,
        type: "public",
      },
    ],
  };

  if (overrides.blockExplorers) {
    metadata.blockExplorers = clone(overrides.blockExplorers);
  } else if (baseChainMetadata.blockExplorers) {
    metadata.blockExplorers = clone(baseChainMetadata.blockExplorers);
  }

  if (overrides.icon) {
    metadata.icon = overrides.icon;
  } else if (baseChainMetadata.icon) {
    metadata.icon = baseChainMetadata.icon;
  }

  if (overrides.features) {
    metadata.features = overrides.features;
  } else if (baseChainMetadata.features) {
    metadata.features = baseChainMetadata.features;
  }

  if (overrides.tags) {
    metadata.tags = overrides.tags;
  } else if (baseChainMetadata.tags) {
    metadata.tags = baseChainMetadata.tags;
  }

  if (overrides.extensions) {
    metadata.extensions = { ...overrides.extensions };
  } else if (baseChainMetadata.extensions) {
    metadata.extensions = clone(baseChainMetadata.extensions);
  }

  if (overrides.providerPolicies) {
    metadata.providerPolicies = clone(overrides.providerPolicies);
  } else if (baseChainMetadata.providerPolicies) {
    metadata.providerPolicies = clone(baseChainMetadata.providerPolicies);
  }

  return metadata;
};

export const toRegistryEntity = (metadata: ChainMetadata, updatedAt = Date.now()): ChainRegistryEntity => ({
  chainRef: metadata.chainRef,
  namespace: metadata.namespace,
  metadata: clone(metadata),
  updatedAt,
  schemaVersion: CHAIN_REGISTRY_ENTITY_SCHEMA_VERSION,
});

// Mock chain registry implementation
export class MemoryChainRegistryPort implements ChainRegistryPort {
  private entities = new Map<ChainRef, ChainRegistryEntity>();

  constructor(seed?: ChainRegistryEntity[]) {
    seed?.forEach((entity) => {
      this.entities.set(entity.chainRef, clone(entity));
    });
  }

  async get(chainRef: ChainRef): Promise<ChainRegistryEntity | null> {
    const entity = this.entities.get(chainRef);
    return entity ? clone(entity) : null;
  }

  async getAll(): Promise<ChainRegistryEntity[]> {
    return Array.from(this.entities.values(), (entity) => clone(entity));
  }

  async put(entity: ChainRegistryEntity): Promise<void> {
    this.entities.set(entity.chainRef, clone(entity));
  }

  async putMany(entities: ChainRegistryEntity[]): Promise<void> {
    entities.forEach((entity) => {
      this.entities.set(entity.chainRef, clone(entity));
    });
  }

  async delete(chainRef: ChainRef): Promise<void> {
    this.entities.delete(chainRef);
  }

  async clear(): Promise<void> {
    this.entities.clear();
  }
}

// Mock storage port implementation
export class MemoryStoragePort implements StoragePort {
  private snapshots = new Map<StorageNamespace, StorageSnapshotMap[StorageNamespace]>();
  private vaultMeta: VaultMetaSnapshot | null;
  public readonly savedSnapshots: Array<{
    namespace: StorageNamespace;
    envelope: StorageSnapshotMap[StorageNamespace];
  }> = [];
  public readonly clearedSnapshots: StorageNamespace[] = [];
  public savedVaultMeta: VaultMetaSnapshot | null = null;
  public clearedVaultMeta = false;

  constructor(seed?: { snapshots?: StorageSeed; vaultMeta?: VaultMetaSnapshot | null }) {
    this.vaultMeta = seed?.vaultMeta ?? null;
    if (seed?.snapshots) {
      for (const [namespace, envelope] of Object.entries(seed.snapshots) as Array<
        [StorageNamespace, StorageSnapshotMap[StorageNamespace]]
      >) {
        this.snapshots.set(namespace, clone(envelope));
      }
    }
  }

  async loadSnapshot<Namespace extends StorageNamespace>(
    namespace: Namespace,
  ): Promise<StorageSnapshotMap[Namespace] | null> {
    const snapshot = this.snapshots.get(namespace);
    return snapshot ? (clone(snapshot) as StorageSnapshotMap[Namespace]) : null;
  }

  async saveSnapshot<Namespace extends StorageNamespace>(
    namespace: Namespace,
    envelope: StorageSnapshotMap[Namespace],
  ): Promise<void> {
    this.snapshots.set(namespace, clone(envelope));
    this.savedSnapshots.push({ namespace, envelope: clone(envelope) });
  }

  async clearSnapshot(namespace: StorageNamespace): Promise<void> {
    this.snapshots.delete(namespace);
    this.clearedSnapshots.push(namespace);
  }

  async loadVaultMeta(): Promise<VaultMetaSnapshot | null> {
    return this.vaultMeta ? clone(this.vaultMeta) : null;
  }

  async saveVaultMeta(snapshot: VaultMetaSnapshot): Promise<void> {
    this.vaultMeta = clone(snapshot);
    this.savedVaultMeta = clone(snapshot);
  }

  async clearVaultMeta(): Promise<void> {
    this.vaultMeta = null;
    this.clearedVaultMeta = true;
  }
}

// Fake vault implementation for testing
export class FakeVault implements VaultService {
  #ciphertext: VaultCiphertext | null;
  #unlocked = false;
  #counter = 0;
  #password: string | null = null;
  #secret: Uint8Array | null = null;

  constructor(
    private readonly clock: () => number,
    initialCiphertext: VaultCiphertext | null = null,
  ) {
    this.#ciphertext = initialCiphertext ? { ...initialCiphertext } : null;
  }

  private createCiphertext(): VaultCiphertext {
    const createdAt = this.clock();
    this.#counter += 1;
    return {
      version: 1,
      algorithm: "pbkdf2-sha256",
      salt: "salt-base64",
      iterations: 1,
      iv: "iv-base64",
      cipher: `cipher-${this.#counter}`,
      createdAt,
    };
  }

  async initialize(params: { password: string }): Promise<VaultCiphertext> {
    this.#password = params.password;
    this.#ciphertext = this.createCiphertext();
    this.#unlocked = true;
    // Initialize with empty keyrings payload that KeyringService expects
    const encoder = new TextEncoder();
    this.#secret = encoder.encode(JSON.stringify({ keyrings: [] }));
    return { ...this.#ciphertext };
  }

  async unlock(params: { password: string; ciphertext?: VaultCiphertext }): Promise<Uint8Array> {
    if (!this.#password || params.password !== this.#password) {
      throw new Error("invalid password");
    }

    if (params.ciphertext) {
      if (this.#ciphertext && params.ciphertext.cipher !== this.#ciphertext.cipher) {
        throw new Error("invalid ciphertext");
      }
      this.#ciphertext = { ...params.ciphertext };
    } else if (!this.#ciphertext) {
      throw new Error("ciphertext required");
    }

    this.#unlocked = true;
    if (!this.#secret) {
      // Initialize with empty keyrings payload that KeyringService expects
      const encoder = new TextEncoder();
      this.#secret = encoder.encode(JSON.stringify({ keyrings: [] }));
    }
    return new Uint8Array(this.#secret);
  }

  lock(): void {
    this.#unlocked = false;
  }

  exportKey(): Uint8Array {
    if (!this.#unlocked || !this.#secret) {
      throw new Error("vault locked");
    }
    return new Uint8Array(this.#secret);
  }

  async seal(params: { password: string; secret: Uint8Array }): Promise<VaultCiphertext> {
    if (!this.#password || params.password !== this.#password) {
      throw new Error("invalid password");
    }
    this.#ciphertext = this.createCiphertext();
    this.#secret = new Uint8Array(params.secret);
    return { ...this.#ciphertext };
  }

  verifyPassword(password: string): Promise<void> {
    if (!this.#password || password !== this.#password) {
      throw new Error("invalid password");
    }
    return Promise.resolve();
  }
  async reseal(params: { secret: Uint8Array }): Promise<VaultCiphertext> {
    this.#ciphertext = this.createCiphertext();
    this.#secret = new Uint8Array(params.secret);
    return { ...this.#ciphertext };
  }

  importCiphertext(ciphertext: VaultCiphertext): void {
    this.#ciphertext = { ...ciphertext };
  }

  getCiphertext(): VaultCiphertext | null {
    return this.#ciphertext ? { ...this.#ciphertext } : null;
  }

  getStatus() {
    return {
      isUnlocked: this.#unlocked,
      hasCiphertext: this.#ciphertext !== null,
    };
  }

  isUnlocked(): boolean {
    return this.#unlocked;
  }
}

// Test context type
export type TestBackgroundContext = {
  services: CreateBackgroundServicesResult;
  storagePort: MemoryStoragePort;
  chainRegistryPort: MemoryChainRegistryPort;
  transactionsPort: MemoryTransactionsPort;
  settingsPort?: MemorySettingsPort;
  destroy: () => void;
  enableAutoApproval: () => () => void; // Returns unsubscribe function
};

// Setup options type
export type SetupBackgroundOptions = {
  chainSeed?: ChainMetadata[];
  storageSeed?: StorageSeed;
  settingsSeed?: SettingsRecord | null;
  accountsSeed?: AccountRecord[];
  keyringMetasSeed?: KeyringMetaRecord[];
  permissionsSeed?: PermissionRecord[];
  vaultMeta?: VaultMetaSnapshot | null;
  transactionsSeed?: TransactionRecord[];
  autoLockDuration?: number;
  now?: () => number;
  timers?: RpcTimers;
  vault?: VaultService | (() => VaultService);
  persistDebounceMs?: number;
  transactions?: CreateBackgroundServicesOptions["transactions"];
  storageLogger?: (message: string, error: unknown) => void;
};

/**
 * Sets up a complete background service environment for testing.
 * This function initializes all controllers, storage, and provides helpers
 * like auto-approval for streamlined test scenarios.
 */
export const setupBackground = async (options: SetupBackgroundOptions = {}): Promise<TestBackgroundContext> => {
  const chainSeed = options.chainSeed ?? [createChainMetadata()];
  const chainRegistryPort = new MemoryChainRegistryPort(chainSeed.map((metadata) => toRegistryEntity(metadata, 0)));
  const storagePort = new MemoryStoragePort({
    snapshots: options.storageSeed ?? {},
    vaultMeta: options.vaultMeta ?? null,
  });
  const approvalsPort = new MemoryApprovalsPort();
  const permissionsPort = new MemoryPermissionsPort(options.permissionsSeed ?? []);
  const transactionsPort = new MemoryTransactionsPort(options.transactionsSeed ?? []);
  const accountsPort = new MemoryAccountsPort(options.accountsSeed ?? []);
  const keyringMetasPort = new MemoryKeyringMetasPort(options.keyringMetasSeed ?? []);

  const settingsPort = options.settingsSeed !== undefined ? new MemorySettingsPort(options.settingsSeed) : null;

  const storageOptions: NonNullable<CreateBackgroundServicesOptions["storage"]> = {
    port: storagePort,
    ...(options.now ? { now: options.now } : {}),
    ...(options.storageLogger ? { logger: options.storageLogger } : {}),
  };

  const needsSessionOptions =
    options.autoLockDuration !== undefined ||
    options.timers !== undefined ||
    options.vault !== undefined ||
    options.persistDebounceMs !== undefined;

  const sessionOptions: CreateBackgroundServicesOptions["session"] | undefined = needsSessionOptions
    ? {
        ...(options.autoLockDuration !== undefined ? { autoLockDuration: options.autoLockDuration } : {}),
        ...(options.timers ? { timers: options.timers } : {}),
        ...(options.vault ? { vault: options.vault } : {}),
        ...(options.persistDebounceMs !== undefined ? { persistDebounceMs: options.persistDebounceMs } : {}),
      }
    : undefined;

  const services = createBackgroundServices({
    chainRegistry: {
      port: chainRegistryPort,
      seed: chainSeed,
    },
    store: {
      ports: {
        approvals: approvalsPort,
        permissions: permissionsPort,
        transactions: transactionsPort,
        accounts: accountsPort,
        keyringMetas: keyringMetasPort,
      },
    },
    storage: storageOptions,
    ...(settingsPort ? { settings: { port: settingsPort } } : {}),
    ...(sessionOptions ? { session: sessionOptions } : {}),
    ...(options.transactions ? { transactions: options.transactions } : {}),
  });

  await services.lifecycle.initialize();
  services.lifecycle.start();

  // Helper function to enable auto-approval for testing
  const enableAutoApproval = () => {
    const unsubscribe = services.controllers.approvals.onRequest(async (task) => {
      // Automatically resolve approval requests
      try {
        if (task.type === "wallet_sendTransaction") {
          // For transactions, approve via transaction controller
          const result = await services.controllers.transactions.approveTransaction(task.id);
          await services.controllers.approvals.resolve(task.id, async () => result);
        } else {
          // For other types, resolve with empty result
          await services.controllers.approvals.resolve(task.id, async () => ({}));
        }
      } catch (error) {
        // Ignore errors if approval was already resolved
      }
    });
    return unsubscribe;
  };

  return {
    services,
    storagePort,
    chainRegistryPort,
    transactionsPort,
    ...(settingsPort ? { settingsPort } : {}),
    enableAutoApproval,
    destroy: () => {
      services.lifecycle.destroy();
    },
  };
};

type RpcCallOptions = {
  method: string;
  params?: JsonRpcParams;
  origin?: string;
  rpcContext?: Partial<RpcInvocationContext>;
};

export type RpcHarness = TestBackgroundContext & {
  engine: JsonRpcEngine;
  callRpc(options: RpcCallOptions): Promise<unknown>;
  origins: { internal: string; external: string };
};

export type RpcHarnessOptions = SetupBackgroundOptions & {
  internalOrigin?: string;
  externalOrigin?: string;
};

export const createRpcHarness = async (options: RpcHarnessOptions = {}): Promise<RpcHarness> => {
  const {
    internalOrigin = "chrome-extension://arx",
    externalOrigin = "https://dapp.example",
    ...setupOptions
  } = options;
  const clock = setupOptions.now ?? Date.now;
  const background = await setupBackground({
    ...setupOptions,
    ...(setupOptions.vault === undefined ? { vault: () => new FakeVault(clock) } : {}),
  });
  const { services } = background;

  const deriveMethodNamespace = createMethodNamespaceResolver(services.controllers);
  const engine = services.engine;

  const buildRpcContext = (overrides?: Partial<RpcInvocationContext>): RpcInvocationContext => {
    const chain = services.controllers.network.getActiveChain();
    const namespace = overrides?.namespace ?? chain.namespace;
    const chainRef = overrides?.chainRef ?? chain.chainRef;
    return {
      namespace,
      chainRef,
      ...(overrides?.requestContext !== undefined ? { requestContext: overrides.requestContext } : {}),
      ...(overrides?.meta ? { meta: overrides.meta } : {}),
    };
  };

  createRpcEngineForBackground(services, {
    isInternalOrigin: (origin) => origin === internalOrigin,
    shouldRequestUnlockAttention: () => false,
    shouldRequestApprovalAttention: () => false,
  });

  let nextRequestId = 0;
  const sessionId = crypto.randomUUID();
  const portId = "test-port";
  const callRpc = async ({ method, params, origin = externalOrigin, rpcContext }: RpcCallOptions) => {
    const requestId = `${++nextRequestId}`;
    const contextPayload = buildRpcContext({
      ...(rpcContext ?? {}),
      requestContext:
        rpcContext?.requestContext ??
        ({
          transport: "provider",
          portId,
          sessionId,
          requestId,
          origin,
        } as const),
    });
    const namespace = deriveMethodNamespace(method, contextPayload);
    const resolvedChainRef = contextPayload.chainRef ?? services.controllers.network.getActiveChain().chainRef;
    return new Promise<unknown>((resolve, reject) => {
      engine.handle(
        {
          id: requestId,
          jsonrpc: "2.0",
          method,
          params,
          origin,
          arx: contextPayload,
        } as JsonRpcRequest,
        (error, response) => {
          if (error) {
            reject(
              encodeErrorWithAdapters(error, {
                surface: "dapp",
                namespace,
                chainRef: resolvedChainRef,
                origin,
                method,
              }),
            );
            return;
          }
          if (!response) {
            reject(new Error("Missing JSON-RPC response"));
            return;
          }
          if ("error" in response && response.error) {
            reject(response.error);
            return;
          }
          if ("result" in response) {
            resolve(response.result);
            return;
          }
          reject(new Error("Invalid JSON-RPC response payload"));
        },
      );
    });
  };

  return {
    ...background,
    engine,
    callRpc,
    origins: { internal: internalOrigin, external: externalOrigin },
  };
};
