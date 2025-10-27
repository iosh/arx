import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_CHAIN_METADATA } from "../chains/chains.seed.js";
import type { Caip2ChainId } from "../chains/ids.js";
import type { ChainMetadata } from "../chains/metadata.js";
import type { ChainRegistryPort } from "../chains/registryPort.js";
import { ApprovalTypes, PermissionScopes } from "../controllers/index.js";
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
import type { VaultCiphertext, VaultService } from "../vault/types.js";
import {
  type CreateBackgroundServicesOptions,
  type CreateBackgroundServicesResult,
  createBackgroundServices,
} from "./createBackgroundServices.js";

type RpcTimers = {
  setTimeout?: typeof setTimeout;
  clearTimeout?: typeof clearTimeout;
};

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

const isAccountsSnapshotEntry = (
  entry: SnapshotEntry,
): entry is { namespace: typeof StorageNamespaces.Accounts; envelope: AccountsSnapshot } =>
  entry.namespace === StorageNamespaces.Accounts;

const isNetworkSnapshotEntry = (
  entry: SnapshotEntry,
): entry is { namespace: typeof StorageNamespaces.Network; envelope: NetworkSnapshot } =>
  entry.namespace === StorageNamespaces.Network;

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

  async initialize(): Promise<VaultCiphertext> {
    this.#ciphertext = this.createCiphertext();
    this.#unlocked = true;
    return { ...this.#ciphertext };
  }

  async unlock(params: { ciphertext?: VaultCiphertext }): Promise<Uint8Array> {
    if (params.ciphertext) {
      this.#ciphertext = { ...params.ciphertext };
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

  async seal(): Promise<VaultCiphertext> {
    this.#ciphertext = this.createCiphertext();
    this.#unlocked = true;
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
};

type TestBackgroundContext = {
  services: CreateBackgroundServicesResult;
  storagePort: MemoryStoragePort;
  chainRegistryPort: MemoryChainRegistryPort;
  destroy: () => void;
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
  });

  await services.lifecycle.initialize();
  services.lifecycle.start();

  return {
    services,
    storagePort,
    chainRegistryPort,
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
      const accountAddress = "0xaabbccddeeff00112233445566778899aabbccdd";
      await services.controllers.accounts.addAccount({
        chainRef: mainChain.chainRef,
        address: accountAddress,
        makePrimary: true,
      });

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

      const accountsSnapshots = storagePort.savedSnapshots.filter(isAccountsSnapshotEntry);
      expect(accountsSnapshots.length).toBeGreaterThan(0);
      expect(accountsSnapshots.at(-1)?.envelope.payload.active?.chainRef).toBe(secondaryChain.chainRef);

      const networkSnapshots = storagePort.savedSnapshots.filter(isNetworkSnapshotEntry);
      expect(networkSnapshots.length).toBeGreaterThan(0);
      expect(networkSnapshots.at(-1)?.envelope.payload.activeChain).toBe(secondaryChain.chainRef);
      expect(networkSnapshots.at(-1)?.envelope.payload.knownChains.map((chain) => chain.chainRef)).toEqual(
        expect.arrayContaining([mainChain.chainRef, secondaryChain.chainRef]),
      );
    } finally {
      context.destroy();
    }
  });

  it("persists unlock snapshot metadata for recovery workflows", async () => {
    const autoLockMs = 1_000;
    const chain = createChainMetadata();
    let currentTime = 5_000;
    const clock = () => currentTime;
    const vaultFactory = () => new FakeVault(clock);

    const first = await setupBackground({
      chainSeed: [chain],
      now: clock,
      vault: vaultFactory,
      autoLockDuration: autoLockMs,
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
      autoLockDuration: autoLockMs,
      persistDebounceMs: 0,
      vaultMeta: persistedMeta,
    });

    try {
      const restoredMeta = second.services.session.getLastPersistedVaultMeta();
      expect(restoredMeta?.payload.unlockState).toEqual(persistedMeta?.payload.unlockState);

      const unlockState = second.services.session.unlock.getState();
      expect(unlockState.isUnlocked).toBe(false);
      expect(unlockState.timeoutMs).toBe(autoLockMs);
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

    const transactionsSnapshot: TransactionsSnapshot = {
      version: TRANSACTIONS_SNAPSHOT_VERSION,
      updatedAt: 1_000,
      payload: {
        pending: [
          {
            id: "tx-1",
            caip2: mainChain.chainRef,
            origin: "https://dapp.example",
            from: accountAddress,
            request: {
              namespace: mainChain.namespace,
              caip2: mainChain.chainRef,
              payload: {
                chainId: mainChain.chainId,
                from: accountAddress,
                to: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
                value: "0x0",
                data: "0x",
              },
            },
            status: "pending",
            createdAt: 1_000,
            updatedAt: 1_000,
          },
        ],
        history: [],
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
      expect(context.services.controllers.transactions.getState()).toEqual(transactionsSnapshot.payload);

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
});
