import type { JsonRpcEngine } from "@metamask/json-rpc-engine";
import type { JsonRpcParams, JsonRpcRequest } from "@metamask/utils";
import { vi } from "vitest";
import { DEFAULT_CHAIN_METADATA } from "../../chains/chains.seed.js";
import type { Caip2ChainId } from "../../chains/ids.js";
import type { ChainMetadata } from "../../chains/metadata.js";
import type { ChainRegistryPort } from "../../chains/registryPort.js";
import { createMethodNamespaceResolver, encodeErrorWithAdapters, type RpcInvocationContext } from "../../rpc/index.js";
import type {
  AccountsSnapshot,
  ApprovalsSnapshot,
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
  ACCOUNTS_SNAPSHOT_VERSION,
  APPROVALS_SNAPSHOT_VERSION,
  CHAIN_REGISTRY_ENTITY_SCHEMA_VERSION,
  NETWORK_SNAPSHOT_VERSION,
  PERMISSIONS_SNAPSHOT_VERSION,
  StorageNamespaces,
  TRANSACTIONS_SNAPSHOT_VERSION,
} from "../../storage/index.js";
import type { AccountMeta, KeyringMeta } from "../../storage/keyringSchemas.js";
import type { KeyringStorePort } from "../../storage/keyringStore.js";
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

export const baseChainMetadata = DEFAULT_CHAIN_METADATA[0]! as ChainMetadata;

export const flushAsync = async () => {
  await Promise.resolve();
  await Promise.resolve();
};

// Type guards
export const isAccountsSnapshot = (
  entry: SnapshotEntry,
): entry is { namespace: typeof StorageNamespaces.Accounts; envelope: AccountsSnapshot } =>
  entry.namespace === StorageNamespaces.Accounts;

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

// Create in-memory keyring store
export const createInMemoryKeyringStore = (): KeyringStorePort => {
  let keyrings: KeyringMeta[] = [];
  let accounts: AccountMeta[] = [];
  return {
    async getKeyringMetas() {
      return [...keyrings];
    },
    async getAccountMetas() {
      return [...accounts];
    },
    async putKeyringMetas(metas) {
      keyrings = metas.map((m) => ({ ...m }));
    },
    async putAccountMetas(metas) {
      accounts = metas.map((m) => ({ ...m }));
    },
    async deleteKeyringMeta(id) {
      keyrings = keyrings.filter((k) => k.id !== id);
      accounts = accounts.filter((a) => a.keyringId !== id);
    },
    async deleteAccount(address) {
      accounts = accounts.filter((a) => a.address !== address);
    },
    async deleteAccountsByKeyring(keyringId) {
      accounts = accounts.filter((a) => a.keyringId !== keyringId);
    },
  };
};

// Mock chain registry implementation
export class MemoryChainRegistryPort implements ChainRegistryPort {
  private entities = new Map<Caip2ChainId, ChainRegistryEntity>();

  constructor(seed?: ChainRegistryEntity[]) {
    seed?.forEach((entity) => {
      this.entities.set(entity.chainRef, clone(entity));
    });
  }

  async get(chainRef: Caip2ChainId): Promise<ChainRegistryEntity | null> {
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

  async delete(chainRef: Caip2ChainId): Promise<void> {
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
  destroy: () => void;
  enableAutoApproval: () => () => void; // Returns unsubscribe function
};

// Setup options type
export type SetupBackgroundOptions = {
  chainSeed?: ChainMetadata[];
  storageSeed?: StorageSeed;
  vaultMeta?: VaultMetaSnapshot | null;
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

  const storageOptions: NonNullable<CreateBackgroundServicesOptions["storage"]> = {
    port: storagePort,
    keyringStore: createInMemoryKeyringStore(),
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
    storage: storageOptions,
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

  const resolveMethodNamespace = createMethodNamespaceResolver(services.controllers);
  const engine = services.engine;

  const buildRpcContext = (overrides?: Partial<RpcInvocationContext>): RpcInvocationContext => {
    const chain = services.controllers.network.getActiveChain();
    const namespace = overrides?.namespace ?? chain.namespace;
    const chainRef = overrides?.chainRef ?? chain.chainRef;
    return {
      namespace,
      chainRef,
      ...(overrides?.meta ? { meta: overrides.meta } : {}),
    };
  };

  createRpcEngineForBackground(services, {
    isInternalOrigin: (origin) => origin === internalOrigin,
    shouldRequestUnlockAttention: () => false,
    shouldRequestApprovalAttention: () => false,
  });

  let nextRequestId = 0;
  const callRpc = async ({ method, params, origin = externalOrigin, rpcContext }: RpcCallOptions) => {
    const contextPayload = buildRpcContext(rpcContext);
    const resolvedNamespace = resolveMethodNamespace(method, contextPayload);
    const resolvedChainRef = contextPayload.chainRef ?? services.controllers.network.getActiveChain().chainRef;
    return new Promise<unknown>((resolve, reject) => {
      engine.handle(
        {
          id: `${++nextRequestId}`,
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
                namespace: resolvedNamespace,
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
