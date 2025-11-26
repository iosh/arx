import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_CHAIN_METADATA } from "../chains/chains.seed.js";
import type { Caip2ChainId } from "../chains/ids.js";
import type { ChainMetadata } from "../chains/metadata.js";
import type { ChainRegistryPort } from "../chains/registryPort.js";
import { ApprovalTypes, PermissionScopes, type TransactionStatusChange } from "../controllers/index.js";
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
} from "../storage/index.js";
import {
  ACCOUNTS_SNAPSHOT_VERSION,
  APPROVALS_SNAPSHOT_VERSION,
  CHAIN_REGISTRY_ENTITY_SCHEMA_VERSION,
  NETWORK_SNAPSHOT_VERSION,
  PERMISSIONS_SNAPSHOT_VERSION,
  StorageNamespaces,
  TRANSACTIONS_SNAPSHOT_VERSION,
} from "../storage/index.js";
import { TransactionAdapterRegistry } from "../transactions/adapters/registry.js";
import type { TransactionAdapter } from "../transactions/adapters/types.js";
import type { VaultCiphertext, VaultService } from "../vault/types.js";
import { type CreateBackgroundServicesOptions, createBackgroundServices } from "./createBackgroundServices.js";

const TEST_MNEMONIC = "test test test test test test test test test test test junk";

const TEST_AUTO_LOCK_DURATION = 1_000;
const TEST_INITIAL_TIME = 5_000;
const TEST_RECEIPT_POLL_INTERVAL = 3_000;
const TEST_RECEIPT_MAX_DELAY = 30_000;

type RpcTimers = {
  setTimeout?: typeof setTimeout;
  clearTimeout?: typeof clearTimeout;
};

type CreateBackgroundServicesResult = ReturnType<typeof createBackgroundServices>;

type StorageSeed = Partial<Record<StorageNamespace, StorageSnapshotMap[StorageNamespace]>>;

const clone = <T>(value: T): T => structuredClone(value);

const baseChainMetadata = DEFAULT_CHAIN_METADATA[0]! as ChainMetadata;
const flushAsync = async () => {
  await Promise.resolve();
  await Promise.resolve();
};

type SnapshotEntry = {
  namespace: StorageNamespace;
  envelope: StorageSnapshotMap[StorageNamespace];
};

const isAccountsSnapshot = (
  entry: SnapshotEntry,
): entry is { namespace: typeof StorageNamespaces.Accounts; envelope: AccountsSnapshot } =>
  entry.namespace === StorageNamespaces.Accounts;

const isNetworkSnapshot = (
  entry: SnapshotEntry,
): entry is { namespace: typeof StorageNamespaces.Network; envelope: NetworkSnapshot } =>
  entry.namespace === StorageNamespaces.Network;

const isTransactionsSnapshot = (
  entry: SnapshotEntry,
): entry is { namespace: typeof StorageNamespaces.Transactions; envelope: TransactionsSnapshot } =>
  entry.namespace === StorageNamespaces.Transactions;
const buildRpcSnapshot = (metadata: ChainMetadata) => ({
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
const createChainMetadata = (overrides: Partial<ChainMetadata> = {}): ChainMetadata => {
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

const toRegistryEntity = (metadata: ChainMetadata, updatedAt = Date.now()): ChainRegistryEntity => ({
  chainRef: metadata.chainRef,
  namespace: metadata.namespace,
  metadata: clone(metadata),
  updatedAt,
  schemaVersion: CHAIN_REGISTRY_ENTITY_SCHEMA_VERSION,
});

class MemoryChainRegistryPort implements ChainRegistryPort {
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

class MemoryStoragePort implements StoragePort {
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

class FakeVault implements VaultService {
  #ciphertext: VaultCiphertext | null;
  #unlocked = false;
  #counter = 0;
  #password: string | null = null;

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
    return new Uint8Array([1, 2, 3]);
  }

  lock(): void {
    this.#unlocked = false;
  }

  exportKey(): Uint8Array {
    if (!this.#unlocked) {
      throw new Error("vault locked");
    }
    return new Uint8Array([9, 9, 9]);
  }

  async seal(params: { password: string; secret: Uint8Array }): Promise<VaultCiphertext> {
    if (!this.#password || params.password !== this.#password) {
      throw new Error("invalid password");
    }
    this.#ciphertext = this.createCiphertext();
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

type SetupBackgroundOptions = {
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

type TestBackgroundContext = {
  services: CreateBackgroundServicesResult;
  storagePort: MemoryStoragePort;
  chainRegistryPort: MemoryChainRegistryPort;
  destroy: () => void;
  enableAutoApproval: () => () => void; // Returns unsubscribe function
};

const setupBackground = async (options: SetupBackgroundOptions = {}): Promise<TestBackgroundContext> => {
  const chainSeed = options.chainSeed ?? [createChainMetadata()];
  const chainRegistryPort = new MemoryChainRegistryPort(chainSeed.map((metadata) => toRegistryEntity(metadata, 0)));
  const storagePort = new MemoryStoragePort({
    snapshots: options.storageSeed ?? {},
    vaultMeta: options.vaultMeta ?? null,
  });

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

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("createBackgroundServices (integration)", () => {
  it("synchronizes network state, storage, and account pointer when switching to a newly registered chain", async () => {
    const mainChain = createChainMetadata({
      chainRef: "eip155:1",
      chainId: "0x1",
      displayName: "Ethereum Mainnet",
    });
    const secondaryChain = createChainMetadata({
      chainRef: "eip155:1030",
      chainId: "0x406",
      displayName: "Conflux eSpace",
    });

    const context = await setupBackground({ chainSeed: [mainChain] });
    const { services, storagePort } = context;
    try {
      services.keyring.setNamespaceFromMnemonic(mainChain.namespace, { mnemonic: TEST_MNEMONIC });

      const { account } = await services.accountsRuntime.deriveAccount({
        namespace: mainChain.namespace,
        chainRef: mainChain.chainRef,
        makePrimary: true,
        switchActive: true,
      });
      const accountAddress = account.address;

      const pointerBefore = services.controllers.accounts.getActivePointer();
      expect(pointerBefore).toEqual({
        namespace: mainChain.namespace,
        chainRef: mainChain.chainRef,
        address: accountAddress,
      });

      const pointerSwitched = new Promise<void>((resolve) => {
        const unsubscribe = services.controllers.accounts.onActiveChanged((pointer) => {
          if (pointer?.chainRef === secondaryChain.chainRef) {
            unsubscribe();
            resolve();
          }
        });
      });

      await services.controllers.chainRegistry.upsertChain(secondaryChain);
      await services.controllers.network.switchChain(secondaryChain.chainRef);
      await pointerSwitched;
      await flushAsync();

      const pointerAfter = services.controllers.accounts.getActivePointer();
      expect(pointerAfter).toEqual({
        namespace: secondaryChain.namespace,
        chainRef: secondaryChain.chainRef,
        address: accountAddress,
      });

      const networkState = services.controllers.network.getState();
      expect(networkState.activeChain).toBe(secondaryChain.chainRef);
      expect(networkState.knownChains.map((chain) => chain.chainRef)).toEqual(
        expect.arrayContaining([mainChain.chainRef, secondaryChain.chainRef]),
      );

      const accountsSnapshots = storagePort.savedSnapshots.filter(isAccountsSnapshot);
      expect(accountsSnapshots.length).toBeGreaterThan(0);
      expect(accountsSnapshots.at(-1)?.envelope.payload.active?.chainRef).toBe(secondaryChain.chainRef);

      const networkSnapshots = storagePort.savedSnapshots.filter(isNetworkSnapshot);
      expect(networkSnapshots.length).toBeGreaterThan(0);
      expect(networkSnapshots.at(-1)?.envelope.payload.activeChain).toBe(secondaryChain.chainRef);
    } finally {
      context.destroy();
    }
  });

  it("persists unlock snapshot metadata for recovery workflows", async () => {
    const chain = createChainMetadata();
    let currentTime = TEST_INITIAL_TIME;
    const clock = () => currentTime;
    const vaultFactory = () => new FakeVault(clock);

    const first = await setupBackground({
      chainSeed: [chain],
      now: clock,
      vault: vaultFactory,
      autoLockDuration: TEST_AUTO_LOCK_DURATION,
      persistDebounceMs: 0,
    });

    let persistedMeta: VaultMetaSnapshot | null = null;

    try {
      await first.services.session.vault.initialize({ password: "secret" });
      await first.services.session.unlock.unlock({ password: "secret" });
      const unlockedState = first.services.session.unlock.getState();
      expect(unlockedState.isUnlocked).toBe(true);
      expect(unlockedState.nextAutoLockAt).not.toBeNull();

      currentTime += 200;
      await first.services.session.persistVaultMeta();

      persistedMeta = first.storagePort.savedVaultMeta ?? null;
      expect(persistedMeta).not.toBeNull();
      expect(persistedMeta?.payload.unlockState?.isUnlocked).toBe(true);
      expect(persistedMeta?.payload.unlockState?.nextAutoLockAt).toBe(unlockedState.nextAutoLockAt);
    } finally {
      first.destroy();
    }

    const second = await setupBackground({
      chainSeed: [chain],
      now: clock,
      vault: vaultFactory,
      autoLockDuration: TEST_AUTO_LOCK_DURATION,
      persistDebounceMs: 0,
      vaultMeta: persistedMeta,
    });

    try {
      const restoredMeta = second.services.session.getLastPersistedVaultMeta();
      expect(restoredMeta?.payload.unlockState).toEqual(persistedMeta?.payload.unlockState);

      const unlockState = second.services.session.unlock.getState();
      expect(unlockState.isUnlocked).toBe(false);
      expect(unlockState.timeoutMs).toBe(TEST_AUTO_LOCK_DURATION);
      expect(second.storagePort.savedVaultMeta).toBeNull();
    } finally {
      second.destroy();
    }
  });

  it("hydrates controller state from storage snapshots and realigns network state on cold start", async () => {
    const mainChain = createChainMetadata();
    const altChain = createChainMetadata({
      chainRef: "eip155:10",
      chainId: "0xa",
      displayName: "Optimism",
    });
    const orphanChain = createChainMetadata({
      chainRef: "eip155:31337",
      chainId: "0x7a69",
      displayName: "Dev Chain",
    });
    const accountAddress = "0x1234567890abcdef1234567890abcdef12345678";

    const networkSnapshot: NetworkSnapshot = {
      version: NETWORK_SNAPSHOT_VERSION,
      updatedAt: 1_000,
      payload: {
        activeChain: orphanChain.chainRef,
        knownChains: [orphanChain],
        rpc: {
          [orphanChain.chainRef]: buildRpcSnapshot(orphanChain),
        },
      },
    };

    const accountsSnapshot: AccountsSnapshot = {
      version: ACCOUNTS_SNAPSHOT_VERSION,
      updatedAt: 1_000,
      payload: {
        namespaces: {
          [mainChain.namespace]: { all: [accountAddress], primary: accountAddress },
        },
        active: {
          namespace: mainChain.namespace,
          chainRef: mainChain.chainRef,
          address: accountAddress,
        },
      },
    };

    const permissionsSnapshot: PermissionsSnapshot = {
      version: PERMISSIONS_SNAPSHOT_VERSION,
      updatedAt: 1_000,
      payload: {
        origins: {
          "https://dapp.example": {
            [mainChain.namespace]: {
              scopes: [PermissionScopes.Basic, PermissionScopes.Accounts],
              chains: [mainChain.chainRef],
            },
          },
        },
      },
    };

    const approvalsSnapshot: ApprovalsSnapshot = {
      version: APPROVALS_SNAPSHOT_VERSION,
      updatedAt: 1_000,
      payload: {
        pending: [
          {
            id: "approval-1",
            type: ApprovalTypes.RequestAccounts,
            origin: "https://dapp.example",
            namespace: mainChain.namespace,
            chainRef: mainChain.chainRef,
          },
        ],
      },
    };

    const chain = createChainMetadata({
      chainRef: "eip155:1",
      chainId: "0x1",
      displayName: "Ethereum Mainnet",
    });

    const transactionsSnapshot: TransactionsSnapshot = {
      version: TRANSACTIONS_SNAPSHOT_VERSION,
      updatedAt: 1_000,
      payload: {
        pending: [],
        history: [
          {
            id: "tx-storage-1",
            namespace: chain.namespace,
            caip2: chain.chainRef,
            origin: "https://dapp.example",
            from: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
            request: {
              namespace: chain.namespace,
              caip2: chain.chainRef,
              payload: {
                from: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
                to: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
                value: "0x0",
                data: "0x",
              },
            },
            status: "approved",
            hash: null,
            receipt: null,
            error: null,
            userRejected: false,
            warnings: [],
            issues: [],
            createdAt: 1_000,
            updatedAt: 1_000,
          },
        ],
      },
    };

    const context = await setupBackground({
      chainSeed: [mainChain, altChain],
      storageSeed: {
        [StorageNamespaces.Network]: networkSnapshot,
        [StorageNamespaces.Accounts]: accountsSnapshot,
        [StorageNamespaces.Permissions]: permissionsSnapshot,
        [StorageNamespaces.Approvals]: approvalsSnapshot,
        [StorageNamespaces.Transactions]: transactionsSnapshot,
      },
      now: () => 42_000,
    });
    await flushAsync();

    try {
      const initialNetwork = context.services.controllers.network.getState();
      expect(initialNetwork.activeChain).toBe(orphanChain.chainRef);

      const waitForSwitch = new Promise<void>((resolve) => {
        const unsubscribe = context.services.controllers.network.onChainChanged((chain) => {
          if (chain.chainRef === mainChain.chainRef) {
            unsubscribe();
            resolve();
          }
        });
      });

      await context.services.controllers.chainRegistry.upsertChain(mainChain);
      await context.services.controllers.chainRegistry.upsertChain(altChain);
      await waitForSwitch;

      expect(context.services.controllers.accounts.getState()).toEqual(accountsSnapshot.payload);
      expect(context.services.controllers.permissions.getState()).toEqual(permissionsSnapshot.payload);
      expect(context.services.controllers.approvals.getState()).toEqual(approvalsSnapshot.payload);

      // Wait for transaction processing to complete (should transition from approved to failed)
      await vi.waitFor(
        () => {
          const meta = context.services.controllers.transactions.getMeta("tx-storage-1");
          expect(meta?.status).toBe("failed");
        },
        {
          timeout: 1000,
          interval: 10,
        },
      );

      const transactionsState = context.services.controllers.transactions.getState();
      expect(transactionsState.pending).toHaveLength(0);
      expect(transactionsState.history).toHaveLength(1);

      const restoredMeta = transactionsState.history[0];
      expect(restoredMeta?.id).toBe("tx-storage-1");
      expect(restoredMeta?.status).toBe("failed");
      expect(restoredMeta?.error?.message).toContain("not unlocked");

      const networkState = context.services.controllers.network.getState();
      expect(networkState.activeChain).toBe(mainChain.chainRef);
      expect(networkState.knownChains.map((chain) => chain.chainRef)).toEqual(
        expect.arrayContaining([mainChain.chainRef, altChain.chainRef]),
      );
      expect(Object.keys(networkState.rpc)).toEqual(expect.arrayContaining([mainChain.chainRef, altChain.chainRef]));
      expect(networkState.rpc[orphanChain.chainRef]).toBeUndefined();
    } finally {
      context.destroy();
    }
  });

  it("replays approved transactions from storage during initialization", async () => {
    const chain = createChainMetadata({
      chainRef: "eip155:1",
      chainId: "0x1",
      displayName: "Ethereum Mainnet",
    });

    const buildDraft = vi.fn<TransactionAdapter["buildDraft"]>(async () => ({
      prepared: { raw: "0x" },
      summary: { kind: "transfer" },
      warnings: [],
      issues: [],
    }));
    const signTransaction = vi.fn<TransactionAdapter["signTransaction"]>(async () => ({
      raw: "0x1111",
      hash: "0x1111111111111111111111111111111111111111111111111111111111111111",
    }));
    const broadcastTransaction = vi.fn<TransactionAdapter["broadcastTransaction"]>(async (_ctx, signed) => ({
      hash: signed.hash ?? "0x1111111111111111111111111111111111111111111111111111111111111111",
    }));

    const adapter: TransactionAdapter = {
      buildDraft,
      signTransaction,
      broadcastTransaction,
    };
    const registry = new TransactionAdapterRegistry();
    registry.register(chain.namespace, adapter);

    const transactionsSnapshot: TransactionsSnapshot = {
      version: TRANSACTIONS_SNAPSHOT_VERSION,
      updatedAt: 1_000,
      payload: {
        pending: [],
        history: [
          {
            id: "tx-storage-1",
            namespace: chain.namespace,
            caip2: chain.chainRef,
            origin: "https://dapp.example",
            from: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
            request: {
              namespace: chain.namespace,
              caip2: chain.chainRef,
              payload: {
                from: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
                to: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
                value: "0x0",
                data: "0x",
              },
            },
            status: "approved",
            hash: null,
            receipt: null,
            error: null,
            userRejected: false,
            warnings: [],
            issues: [],
            createdAt: 1_000,
            updatedAt: 1_000,
          },
        ],
      },
    };

    const context = await setupBackground({
      chainSeed: [chain],
      storageSeed: {
        [StorageNamespaces.Transactions]: transactionsSnapshot,
      },
      transactions: {
        registry,
        autoApprove: false,
      },
      now: () => 2_000,
    });

    try {
      await flushAsync();

      expect(buildDraft).toHaveBeenCalledTimes(1);
      expect(signTransaction).toHaveBeenCalledTimes(1);
      expect(broadcastTransaction).toHaveBeenCalledTimes(1);

      const resumedMeta = context.services.controllers.transactions.getMeta("tx-storage-1");
      expect(resumedMeta?.status).toBe("broadcast");
      expect(resumedMeta?.hash).toBe("0x1111111111111111111111111111111111111111111111111111111111111111");
    } finally {
      context.destroy();
    }
  });

  it("resumes approved transactions from storage and emits status events", async () => {
    const chain = createChainMetadata({
      chainRef: "eip155:1",
      chainId: "0x1",
      displayName: "Ethereum Mainnet",
    });

    const buildDraft = vi.fn<TransactionAdapter["buildDraft"]>(async () => ({
      prepared: { raw: "0x" },
      summary: { kind: "transfer" },
      warnings: [],
      issues: [],
    }));
    const signTransaction = vi.fn<TransactionAdapter["signTransaction"]>(async () => ({
      raw: "0x1111",
      hash: "0x1111111111111111111111111111111111111111111111111111111111111111",
    }));
    const broadcastTransaction = vi.fn<TransactionAdapter["broadcastTransaction"]>(async (_ctx, signed) => ({
      hash: signed.hash ?? "0x1111111111111111111111111111111111111111111111111111111111111111",
    }));

    const adapter: TransactionAdapter = { buildDraft, signTransaction, broadcastTransaction };
    const registry = new TransactionAdapterRegistry();
    registry.register(chain.namespace, adapter);

    const context = await setupBackground({
      chainSeed: [chain],
      transactions: { registry, autoApprove: false },
      persistDebounceMs: 0,
    });

    const approvedMeta: TransactionsSnapshot["payload"]["pending"][number] = {
      id: "tx-resume-1",
      namespace: chain.namespace,
      caip2: chain.chainRef,
      origin: "https://dapp.example",
      from: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      request: {
        namespace: chain.namespace,
        caip2: chain.chainRef,
        payload: {
          from: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
          to: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
          value: "0x0",
          data: "0x",
        },
      },
      status: "approved",
      hash: null,
      receipt: null,
      error: null,
      userRejected: false,
      warnings: [],
      issues: [],
      createdAt: 1_000,
      updatedAt: 1_000,
    };

    context.services.controllers.transactions.replaceState({
      pending: [],
      history: [approvedMeta],
    });

    const statusEvents: TransactionStatusChange[] = [];
    const queuedEvents: string[] = [];

    const unsubscribeStatus = context.services.messenger.subscribe("transaction:statusChanged", (payload) => {
      if (payload.id === "tx-resume-1") {
        statusEvents.push(payload);
      }
    });
    const unsubscribeQueued = context.services.messenger.subscribe("transaction:queued", (meta) => {
      queuedEvents.push(meta.id);
    });

    try {
      await context.services.controllers.transactions.resumePending();
      await flushAsync();

      expect(buildDraft).toHaveBeenCalledTimes(1);
      expect(signTransaction).toHaveBeenCalledTimes(1);
      expect(broadcastTransaction).toHaveBeenCalledTimes(1);

      const resumedMeta = context.services.controllers.transactions.getMeta("tx-resume-1");
      expect(resumedMeta?.status).toBe("broadcast");
      expect(resumedMeta?.hash).toBe("0x1111111111111111111111111111111111111111111111111111111111111111");

      expect(queuedEvents).toHaveLength(0);
      expect(statusEvents.map(({ previousStatus, nextStatus }) => [previousStatus, nextStatus])).toEqual([
        ["approved", "signed"],
        ["signed", "broadcast"],
      ]);
    } finally {
      unsubscribeStatus();
      unsubscribeQueued();
      context.destroy();
    }
  });

  it("processes an auto-approved transaction through receipt confirmation", async () => {
    const chain = createChainMetadata({
      chainRef: "eip155:1",
      chainId: "0x1",
      displayName: "Ethereum Mainnet",
    });
    const confirmedReceipt = { status: "0x1", blockNumber: "0x10" };

    const buildDraft = vi.fn<TransactionAdapter["buildDraft"]>(async () => ({
      prepared: { raw: "0x" },
      summary: { kind: "transfer" },
      warnings: [],
      issues: [],
    }));
    const signTransaction = vi.fn<TransactionAdapter["signTransaction"]>(async () => ({
      raw: "0x1111",
      hash: "0x1111111111111111111111111111111111111111111111111111111111111111",
    }));
    const broadcastTransaction = vi.fn<TransactionAdapter["broadcastTransaction"]>(async (_ctx, signed) => ({
      hash: signed.hash ?? "0x1111111111111111111111111111111111111111111111111111111111111111",
    }));
    const fetchReceipt = vi.fn<NonNullable<TransactionAdapter["fetchReceipt"]>>(async () => ({
      status: "success",
      receipt: confirmedReceipt,
    }));

    const adapter: TransactionAdapter = { buildDraft, signTransaction, broadcastTransaction, fetchReceipt };
    const registry = new TransactionAdapterRegistry();
    registry.register(chain.namespace, adapter);

    const context = await setupBackground({
      chainSeed: [chain],
      transactions: { registry },
      persistDebounceMs: 0,
    });
    const unsubscribeAutoApproval = context.enableAutoApproval();
    const statusEvents: TransactionStatusChange[] = [];
    const unsubscribeStatus = context.services.messenger.subscribe("transaction:statusChanged", (payload) => {
      statusEvents.push(payload);
    });
    try {
      const submission = await context.services.controllers.transactions.submitTransaction("https://dapp.example", {
        namespace: chain.namespace,
        caip2: chain.chainRef,
        payload: {
          from: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
          to: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
          value: "0x0",
          data: "0x",
        },
      });

      await flushAsync();

      expect(buildDraft).toHaveBeenCalledTimes(1);
      expect(signTransaction).toHaveBeenCalledTimes(1);
      expect(broadcastTransaction).toHaveBeenCalledTimes(1);
      expect(fetchReceipt).not.toHaveBeenCalled();

      const broadcastMeta = context.services.controllers.transactions.getMeta(submission.id);
      expect(broadcastMeta?.status).toBe("broadcast");

      await vi.advanceTimersByTimeAsync(TEST_RECEIPT_POLL_INTERVAL);
      await flushAsync();

      expect(fetchReceipt).toHaveBeenCalledTimes(1);

      const timeline = statusEvents
        .filter((event) => event.id === submission.id)
        .map(({ previousStatus, nextStatus }) => [previousStatus, nextStatus]);

      expect(timeline).toEqual([
        ["pending", "approved"],
        ["approved", "signed"],
        ["signed", "broadcast"],
        ["broadcast", "confirmed"],
      ]);

      const confirmedMeta = context.services.controllers.transactions.getMeta(submission.id);
      expect(confirmedMeta?.status).toBe("confirmed");
      expect(confirmedMeta?.receipt).toMatchObject(confirmedReceipt);

      const snapshots = context.storagePort.savedSnapshots.filter(isTransactionsSnapshot);
      const latest = snapshots.at(-1)?.envelope.payload.history.find((item) => item.id === submission.id);
      expect(latest?.status).toBe("confirmed");
    } finally {
      unsubscribeAutoApproval();
      unsubscribeStatus();
      context.destroy();
    }
  });

  it("handles multiple concurrent transactions independently", async () => {
    const chain = createChainMetadata({
      chainRef: "eip155:1",
      chainId: "0x1",
      displayName: "Ethereum Mainnet",
    });

    const buildDraft = vi.fn<TransactionAdapter["buildDraft"]>(async () => ({
      prepared: { raw: "0x" },
      summary: { kind: "transfer" },
      warnings: [],
      issues: [],
    }));
    const signTransaction = vi.fn<TransactionAdapter["signTransaction"]>(async () => ({
      raw: "0x1111",
      hash: "0x1111111111111111111111111111111111111111111111111111111111111111",
    }));
    const broadcastTransaction = vi.fn<TransactionAdapter["broadcastTransaction"]>(async (_ctx, signed) => ({
      hash: signed.hash ?? "0x1111111111111111111111111111111111111111111111111111111111111111",
    }));
    const fetchReceipt = vi.fn<NonNullable<TransactionAdapter["fetchReceipt"]>>(async () => null);

    const adapter: TransactionAdapter = { buildDraft, signTransaction, broadcastTransaction, fetchReceipt };
    const registry = new TransactionAdapterRegistry();
    registry.register(chain.namespace, adapter);

    const context = await setupBackground({
      chainSeed: [chain],
      transactions: { registry },
      persistDebounceMs: 0,
    });

    const unsubscribeAutoApproval = context.enableAutoApproval();
    const statusEvents: TransactionStatusChange[] = [];
    const unsubscribeStatus = context.services.messenger.subscribe("transaction:statusChanged", (payload) => {
      statusEvents.push(payload);
    });

    try {
      const fromAddresses = [
        "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
        "0xcccccccccccccccccccccccccccccccccccccccc",
      ];
      const toAddresses = [
        "0xdddddddddddddddddddddddddddddddddddddddd",
        "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee",
        "0xffffffffffffffffffffffffffffffffffffffff",
      ];

      const submissions = await Promise.all(
        fromAddresses.map((from, index) =>
          context.services.controllers.transactions.submitTransaction("https://dapp.example", {
            namespace: chain.namespace,
            caip2: chain.chainRef,
            payload: {
              from,
              to: toAddresses[index],
              value: "0x0",
              data: "0x",
            },
          }),
        ),
      );

      await flushAsync();

      await vi.waitFor(() => expect(buildDraft).toHaveBeenCalledTimes(3));
      await vi.waitFor(() => expect(signTransaction).toHaveBeenCalledTimes(3));
      await vi.waitFor(() => expect(broadcastTransaction).toHaveBeenCalledTimes(3));

      const state = context.services.controllers.transactions.getState();
      expect(state.pending).toHaveLength(0);
      expect(state.history).toHaveLength(3);

      const submissionIds = submissions.map((submission) => submission.id);
      expect(new Set(state.history.map((meta) => meta.id))).toEqual(new Set(submissionIds));
      expect(state.history.every((meta) => meta.status === "broadcast")).toBe(true);

      const snapshots = context.storagePort.savedSnapshots.filter(isTransactionsSnapshot);
      const storedHistory = snapshots.at(-1)?.envelope.payload.history ?? [];
      expect(storedHistory.map((meta) => meta.id)).toEqual(expect.arrayContaining(submissionIds));
      expect(storedHistory.every((meta) => meta.status === "broadcast")).toBe(true);

      submissionIds.forEach((id) => {
        const timeline = statusEvents
          .filter((event) => event.id === id)
          .map(({ previousStatus, nextStatus }) => [previousStatus, nextStatus]);

        expect(timeline).toEqual([
          ["pending", "approved"],
          ["approved", "signed"],
          ["signed", "broadcast"],
        ]);
      });
    } finally {
      unsubscribeAutoApproval();
      unsubscribeStatus();
      context.destroy();
    }
  });

  it("marks a broadcast transaction as replaced when detectReplacement resolves", async () => {
    const chain = createChainMetadata({
      chainRef: "eip155:1",
      chainId: "0x1",
      displayName: "Ethereum Mainnet",
    });
    const replacementHash = "0x2222222222222222222222222222222222222222222222222222222222222222";

    const buildDraft = vi.fn<TransactionAdapter["buildDraft"]>(async () => ({
      prepared: { raw: "0x" },
      summary: { kind: "transfer" },
      warnings: [],
      issues: [],
    }));
    const signTransaction = vi.fn<TransactionAdapter["signTransaction"]>(async () => ({
      raw: "0x1111",
      hash: "0x1111111111111111111111111111111111111111111111111111111111111111",
    }));
    const broadcastTransaction = vi.fn<TransactionAdapter["broadcastTransaction"]>(async (_ctx, signed) => ({
      hash: signed.hash ?? "0x1111111111111111111111111111111111111111111111111111111111111111",
    }));
    const fetchReceipt = vi.fn<NonNullable<TransactionAdapter["fetchReceipt"]>>(async () => null);
    const detectReplacement = vi.fn<NonNullable<TransactionAdapter["detectReplacement"]>>(async () => ({
      status: "replaced",
      hash: replacementHash,
    }));

    const adapter: TransactionAdapter = {
      buildDraft,
      signTransaction,
      broadcastTransaction,
      fetchReceipt,
      detectReplacement,
    };
    const registry = new TransactionAdapterRegistry();
    registry.register(chain.namespace, adapter);

    const context = await setupBackground({
      chainSeed: [chain],
      transactions: { registry },
      persistDebounceMs: 0,
    });

    const unsubscribeAutoApproval = context.enableAutoApproval();
    try {
      const submission = await context.services.controllers.transactions.submitTransaction("https://dapp.example", {
        namespace: chain.namespace,
        caip2: chain.chainRef,
        payload: {
          from: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
          to: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
          value: "0x0",
          data: "0x",
        },
      });

      await flushAsync();

      expect(buildDraft).toHaveBeenCalledTimes(1);
      expect(signTransaction).toHaveBeenCalledTimes(1);
      expect(broadcastTransaction).toHaveBeenCalledTimes(1);

      await vi.advanceTimersByTimeAsync(TEST_RECEIPT_POLL_INTERVAL);
      await flushAsync();

      expect(fetchReceipt).toHaveBeenCalledTimes(1);
      expect(detectReplacement).toHaveBeenCalledTimes(1);

      const replacedMeta = context.services.controllers.transactions.getMeta(submission.id);
      expect(replacedMeta?.status).toBe("replaced");
      expect(replacedMeta?.hash).toBe(replacementHash);
      expect(replacedMeta?.error?.name).toBe("TransactionReplacedError");

      const snapshots = context.storagePort.savedSnapshots.filter(isTransactionsSnapshot);
      const latest = snapshots.at(-1)?.envelope.payload.history.find((item) => item.id === submission.id);
      expect(latest?.status).toBe("replaced");
      expect(latest?.hash).toBe(replacementHash);
    } finally {
      unsubscribeAutoApproval();
      context.destroy();
    }
  });

  it("marks a broadcast transaction as failed when receipt polling exceeds max attempts", async () => {
    const chain = createChainMetadata({
      chainRef: "eip155:1",
      chainId: "0x1",
      displayName: "Ethereum Mainnet",
    });

    const buildDraft = vi.fn<TransactionAdapter["buildDraft"]>(async () => ({
      prepared: { raw: "0x" },
      summary: { kind: "transfer" },
      warnings: [],
      issues: [],
    }));
    const signTransaction = vi.fn<TransactionAdapter["signTransaction"]>(async () => ({
      raw: "0x1111",
      hash: "0x1111111111111111111111111111111111111111111111111111111111111111",
    }));
    const broadcastTransaction = vi.fn<TransactionAdapter["broadcastTransaction"]>(async (_ctx, signed) => ({
      hash: signed.hash ?? "0x1111111111111111111111111111111111111111111111111111111111111111",
    }));
    const fetchReceipt = vi.fn<NonNullable<TransactionAdapter["fetchReceipt"]>>(async () => null);

    const adapter: TransactionAdapter = { buildDraft, signTransaction, broadcastTransaction, fetchReceipt };
    const registry = new TransactionAdapterRegistry();
    registry.register(chain.namespace, adapter);

    const context = await setupBackground({
      chainSeed: [chain],
      transactions: { registry },
      persistDebounceMs: 0,
    });
    const unsubscribeAutoApproval = context.enableAutoApproval();

    try {
      const submission = await context.services.controllers.transactions.submitTransaction("https://dapp.example", {
        namespace: chain.namespace,
        caip2: chain.chainRef,
        payload: {
          from: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
          to: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
          value: "0x0",
          data: "0x",
        },
      });

      await flushAsync();

      for (let attempt = 0; attempt < 20; attempt += 1) {
        const delay = Math.min(TEST_RECEIPT_POLL_INTERVAL * 2 ** attempt, TEST_RECEIPT_MAX_DELAY);
        await vi.advanceTimersByTimeAsync(delay);
        await flushAsync();
      }

      expect(fetchReceipt).toHaveBeenCalledTimes(20);

      const failedMeta = context.services.controllers.transactions.getMeta(submission.id);
      expect(failedMeta?.status).toBe("failed");
      expect(failedMeta?.error?.name).toBe("TransactionReceiptTimeoutError");

      const snapshots = context.storagePort.savedSnapshots.filter(isTransactionsSnapshot);
      const latest = snapshots.at(-1)?.envelope.payload.history.find((item) => item.id === submission.id);
      expect(latest?.status).toBe("failed");
      expect(latest?.error?.name).toBe("TransactionReceiptTimeoutError");
    } finally {
      unsubscribeAutoApproval();
      context.destroy();
    }
  });

  it("marks a broadcast transaction as failed when receipt resolution reports failure", async () => {
    const chain = createChainMetadata({
      chainRef: "eip155:1",
      chainId: "0x1",
      displayName: "Ethereum Mainnet",
    });
    const failedReceipt = { status: "0x0", blockNumber: "0x20" };

    const buildDraft = vi.fn<TransactionAdapter["buildDraft"]>(async () => ({
      prepared: { raw: "0x" },
      summary: { kind: "transfer" },
      warnings: [],
      issues: [],
    }));
    const signTransaction = vi.fn<TransactionAdapter["signTransaction"]>(async () => ({
      raw: "0x1111",
      hash: "0x1111111111111111111111111111111111111111111111111111111111111111",
    }));
    const broadcastTransaction = vi.fn<TransactionAdapter["broadcastTransaction"]>(async (_ctx, signed) => ({
      hash: signed.hash ?? "0x1111111111111111111111111111111111111111111111111111111111111111",
    }));
    const fetchReceipt = vi.fn<NonNullable<TransactionAdapter["fetchReceipt"]>>(async () => ({
      status: "failed",
      receipt: failedReceipt,
    }));

    const adapter: TransactionAdapter = { buildDraft, signTransaction, broadcastTransaction, fetchReceipt };
    const registry = new TransactionAdapterRegistry();
    registry.register(chain.namespace, adapter);

    const context = await setupBackground({
      chainSeed: [chain],
      transactions: { registry },
      persistDebounceMs: 0,
    });
    const unsubscribeAutoApproval = context.enableAutoApproval();

    try {
      const submission = await context.services.controllers.transactions.submitTransaction("https://dapp.example", {
        namespace: chain.namespace,
        caip2: chain.chainRef,
        payload: {
          from: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
          to: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
          value: "0x0",
          data: "0x",
        },
      });

      await flushAsync();

      expect(buildDraft).toHaveBeenCalledTimes(1);
      expect(signTransaction).toHaveBeenCalledTimes(1);
      expect(broadcastTransaction).toHaveBeenCalledTimes(1);

      await vi.advanceTimersByTimeAsync(TEST_RECEIPT_POLL_INTERVAL);
      await flushAsync();

      expect(fetchReceipt).toHaveBeenCalledTimes(1);

      const failedMeta = context.services.controllers.transactions.getMeta(submission.id);
      expect(failedMeta?.status).toBe("failed");
      expect(failedMeta?.error?.name).toBe("TransactionExecutionFailed");
      expect(failedMeta?.receipt).toMatchObject(failedReceipt);

      const snapshots = context.storagePort.savedSnapshots.filter(isTransactionsSnapshot);
      const latest = snapshots.at(-1)?.envelope.payload.history.find((item) => item.id === submission.id);
      expect(latest?.status).toBe("failed");
      expect(latest?.error?.name).toBe("TransactionExecutionFailed");
    } finally {
      unsubscribeAutoApproval();
      context.destroy();
    }
  });
  it("clears invalid transaction snapshots during hydration", async () => {
    const chain = createChainMetadata({
      chainRef: "eip155:1",
      chainId: "0x1",
      displayName: "Ethereum Mainnet",
    });

    const corruptedSnapshot = {
      version: TRANSACTIONS_SNAPSHOT_VERSION,
      updatedAt: 1_000,
      payload: {
        pending: [
          {
            id: "broken",
            namespace: chain.namespace,
            caip2: chain.chainRef,
            origin: "https://dapp.example",
          },
        ],
        history: [],
      },
    } as unknown as TransactionsSnapshot;

    const logger = vi.fn();

    const context = await setupBackground({
      chainSeed: [chain],
      storageSeed: { [StorageNamespaces.Transactions]: corruptedSnapshot },
      storageLogger: logger,
    });

    try {
      expect(context.services.controllers.transactions.getState()).toEqual({ pending: [], history: [] });
      expect(context.storagePort.clearedSnapshots).toContain(StorageNamespaces.Transactions);
      expect(logger).toHaveBeenCalledWith(
        expect.stringContaining("storage: failed to hydrate"),
        expect.objectContaining({
          name: "TypeError",
          message: expect.stringContaining("namespace"),
        }),
      );
    } finally {
      context.destroy();
    }
  });
});
