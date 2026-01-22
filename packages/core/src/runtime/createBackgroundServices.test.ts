import { describe, expect, it, vi } from "vitest";
import type { ChainMetadata } from "../chains/metadata.js";
import type { ChainRegistryPort } from "../chains/registryPort.js";
import { ApprovalTypes, PermissionScopes, type TransactionMeta } from "../controllers/index.js";
import type { Eip155RpcCapabilities } from "../rpc/clients/eip155/eip155.js";
import { EIP155_NAMESPACE } from "../rpc/handlers/namespaces/utils.js";
import type {
  AccountMeta,
  ChainRegistryEntity,
  KeyringMeta,
  KeyringStorePort,
  StorageNamespace,
  StoragePort,
  StorageSnapshotMap,
  VaultMetaSnapshot,
} from "../storage/index.js";
import {
  ACCOUNTS_SNAPSHOT_VERSION,
  type AccountsSnapshot,
  APPROVALS_SNAPSHOT_VERSION,
  type ApprovalsSnapshot,
  NETWORK_SNAPSHOT_VERSION,
  type NetworkSnapshot,
  PERMISSIONS_SNAPSHOT_VERSION,
  type PermissionsSnapshot,
  StorageNamespaces,
  TRANSACTIONS_SNAPSHOT_VERSION,
  type TransactionsSnapshot,
  VAULT_META_SNAPSHOT_VERSION,
} from "../storage/index.js";
import { TransactionAdapterRegistry } from "../transactions/adapters/registry.js";
import type { TransactionAdapter } from "../transactions/adapters/types.js";
import type { VaultCiphertext, VaultService } from "../vault/types.js";
import { type CreateBackgroundServicesOptions, createBackgroundServices } from "./createBackgroundServices.js";

const TEST_MNEMONIC = "test test test test test test test test test test test junk";

const MAINNET_CHAIN: ChainMetadata = {
  chainRef: "eip155:1",
  namespace: "eip155",
  chainId: "0x1",
  displayName: "Ethereum",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcEndpoints: [{ url: "https://rpc.mainnet", type: "public" }],
};

const ALT_CHAIN: ChainMetadata = {
  chainRef: "eip155:10",
  namespace: "eip155",
  chainId: "0xa",
  displayName: "Alt Chain",
  nativeCurrency: { name: "Alter", symbol: "ALT", decimals: 18 },
  rpcEndpoints: [{ url: "https://rpc.alt", type: "public" }],
};

const NETWORK_SNAPSHOT: NetworkSnapshot = {
  version: NETWORK_SNAPSHOT_VERSION,
  updatedAt: 1_000,
  payload: {
    activeChain: ALT_CHAIN.chainRef,
    knownChains: [ALT_CHAIN, MAINNET_CHAIN],
    rpc: {
      [ALT_CHAIN.chainRef]: {
        activeIndex: 0,
        endpoints: [{ index: 0, url: ALT_CHAIN.rpcEndpoints[0]!.url, type: "public" as const }],
        health: [{ index: 0, successCount: 4, failureCount: 0, consecutiveFailures: 0 }],
        strategy: { id: "round-robin" },
        lastUpdatedAt: 900,
      },
      [MAINNET_CHAIN.chainRef]: {
        activeIndex: 0,
        endpoints: [{ index: 0, url: MAINNET_CHAIN.rpcEndpoints[0]!.url, type: "public" as const }],
        health: [{ index: 0, successCount: 2, failureCount: 1, consecutiveFailures: 0 }],
        strategy: { id: "round-robin" },
        lastUpdatedAt: 850,
      },
    },
  },
};

const ACCOUNTS_SNAPSHOT: AccountsSnapshot = {
  version: ACCOUNTS_SNAPSHOT_VERSION,
  updatedAt: 1_000,
  payload: {
    namespaces: {
      eip155: { all: ["0xabc", "0xdef"], primary: "0xabc" },
    },
    active: { namespace: "eip155", chainRef: "eip155:1", address: "0xabc" },
  },
};

const PERMISSIONS_SNAPSHOT: PermissionsSnapshot = {
  version: PERMISSIONS_SNAPSHOT_VERSION,
  updatedAt: 1_000,
  payload: {
    origins: {
      "https://dapp.example": {
        eip155: {
          scopes: [PermissionScopes.Basic, PermissionScopes.Accounts],
          chains: ["eip155:1"],
        },
        conflux: {
          scopes: [PermissionScopes.Sign],
          chains: ["conflux:cfx"],
        },
      },
    },
  },
};

const APPROVALS_SNAPSHOT: ApprovalsSnapshot = {
  version: APPROVALS_SNAPSHOT_VERSION,
  updatedAt: 1_000,
  payload: {
    pending: [
      {
        id: "approval-1",
        type: ApprovalTypes.RequestAccounts,
        origin: "https://dapp.example",
        namespace: "eip155",
        chainRef: "eip155:1",
        createdAt: 1_000,
      },
    ],
  },
};
const TRANSACTIONS_SNAPSHOT: TransactionsSnapshot = {
  version: TRANSACTIONS_SNAPSHOT_VERSION,
  updatedAt: 1_000,
  payload: {
    pending: [
      {
        id: "tx-1",
        namespace: "eip155",
        chainRef: "eip155:1",
        origin: "https://dapp.example",
        from: "0xabc",
        request: {
          namespace: "eip155",
          chainRef: "eip155:1",
          payload: {
            chainId: "0x1",
            from: "0xabc",
            to: "0xdef",
            value: "0x0",
            data: "0x",
          },
        },
        status: "pending",
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
    history: [],
  },
};

const FAKE_CIPHERTEXT: VaultCiphertext = {
  version: 1,
  algorithm: "pbkdf2-sha256",
  salt: "salt-base64",
  iterations: 1,
  iv: "iv-base64",
  cipher: "cipher-payload",
  createdAt: 500,
};

const VAULT_META: VaultMetaSnapshot = {
  version: VAULT_META_SNAPSHOT_VERSION,
  updatedAt: 1_000,
  payload: {
    ciphertext: FAKE_CIPHERTEXT,
    autoLockDuration: 120_000,
    initializedAt: 500,
  },
};

const createInMemoryKeyringStore = (): KeyringStorePort => {
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

const flushMicrotasks = () => new Promise((resolve) => setTimeout(resolve, 0));

class MemoryStoragePort implements StoragePort {
  private readonly snapshots = new Map<StorageNamespace, StorageSnapshotMap[StorageNamespace]>();
  private readonly snapshotLoadFailures = new Map<StorageNamespace, unknown>();
  private vaultMeta: VaultMetaSnapshot | null;
  public readonly savedSnapshots: Array<{
    namespace: StorageNamespace;
    envelope: StorageSnapshotMap[StorageNamespace];
  }> = [];
  public readonly clearedSnapshots: StorageNamespace[] = [];
  public savedVaultMeta: VaultMetaSnapshot | null = null;
  public clearedVaultMeta = false;

  constructor(seed?: {
    snapshots?: Partial<Record<StorageNamespace, StorageSnapshotMap[StorageNamespace]>>;
    vaultMeta?: VaultMetaSnapshot | null;
  }) {
    if (seed?.snapshots) {
      for (const [namespace, envelope] of Object.entries(seed.snapshots) as Array<
        [StorageNamespace, StorageSnapshotMap[StorageNamespace]]
      >) {
        this.snapshots.set(namespace, envelope);
      }
    }
    this.vaultMeta = seed?.vaultMeta ?? null;
  }

  setSnapshotLoadFailure(namespace: StorageNamespace, error: unknown) {
    this.snapshotLoadFailures.set(namespace, error);
  }

  clearSnapshotLoadFailure(namespace: StorageNamespace) {
    this.snapshotLoadFailures.delete(namespace);
  }

  getSnapshot<TNamespace extends StorageNamespace>(namespace: TNamespace): StorageSnapshotMap[TNamespace] | null {
    return (this.snapshots.get(namespace) as StorageSnapshotMap[TNamespace]) ?? null;
  }

  getVaultMeta() {
    return this.vaultMeta;
  }

  async loadSnapshot<TNamespace extends StorageNamespace>(
    namespace: TNamespace,
  ): Promise<StorageSnapshotMap[TNamespace] | null> {
    if (this.snapshotLoadFailures.has(namespace)) {
      throw this.snapshotLoadFailures.get(namespace);
    }
    return this.getSnapshot(namespace);
  }

  async saveSnapshot<TNamespace extends StorageNamespace>(
    namespace: TNamespace,
    envelope: StorageSnapshotMap[TNamespace],
  ): Promise<void> {
    this.snapshots.set(namespace, envelope);
    this.savedSnapshots.push({ namespace, envelope: envelope as StorageSnapshotMap[StorageNamespace] });
  }

  async clearSnapshot(namespace: StorageNamespace): Promise<void> {
    this.snapshots.delete(namespace);
    this.clearedSnapshots.push(namespace);
  }

  async loadVaultMeta(): Promise<VaultMetaSnapshot | null> {
    return this.vaultMeta;
  }

  async saveVaultMeta(envelope: VaultMetaSnapshot): Promise<void> {
    this.vaultMeta = envelope;
    this.savedVaultMeta = envelope;
  }

  async clearVaultMeta(): Promise<void> {
    this.vaultMeta = null;
    this.clearedVaultMeta = true;
  }
}

class MemoryChainRegistryPort implements ChainRegistryPort {
  private readonly entries = new Map<string, ChainRegistryEntity>();

  async get(chainRef: string): Promise<ChainRegistryEntity | null> {
    return this.entries.get(chainRef) ?? null;
  }

  async getAll(): Promise<ChainRegistryEntity[]> {
    return Array.from(this.entries.values());
  }

  async put(entity: ChainRegistryEntity): Promise<void> {
    this.entries.set(entity.chainRef, entity);
  }

  async putMany(entities: ChainRegistryEntity[]): Promise<void> {
    for (const entity of entities) {
      this.entries.set(entity.chainRef, entity);
    }
  }

  async delete(chainRef: string): Promise<void> {
    this.entries.delete(chainRef);
  }

  async clear(): Promise<void> {
    this.entries.clear();
  }
}

type TestServicesOptions = Omit<CreateBackgroundServicesOptions, "chainRegistry"> & {
  chainRegistry?: Omit<NonNullable<CreateBackgroundServicesOptions["chainRegistry"]>, "port"> & {
    port?: ChainRegistryPort;
  };
};

const createServices = (options: TestServicesOptions = {}) => {
  const chainRegistryOptions = options.chainRegistry;
  if (chainRegistryOptions?.port) {
    return createBackgroundServices(options as CreateBackgroundServicesOptions);
  }

  const adapted: CreateBackgroundServicesOptions = {
    ...options,
    chainRegistry: {
      ...chainRegistryOptions,
      port: new MemoryChainRegistryPort(),
    },
  };

  return createBackgroundServices(adapted);
};

const makeAdapter = (tag: string): TransactionAdapter => ({
  buildDraft: async () => ({ prepared: { tag }, summary: {}, warnings: [], issues: [] }),
  signTransaction: async () => ({ raw: "0x", hash: `0x${tag}` }),
  broadcastTransaction: async () => ({ hash: `0x${tag}` }),
});

class FakeVault implements VaultService {
  #ciphertext: VaultCiphertext | null;
  #unlocked = false;
  #counter = 0;
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

  async initialize(params: { password: string; secret?: Uint8Array }): Promise<VaultCiphertext> {
    this.#ciphertext = this.createCiphertext();
    this.#unlocked = true;
    this.#secret = params.secret ? new Uint8Array(params.secret) : new Uint8Array([1, 2, 3]);
    return { ...this.#ciphertext };
  }

  async unlock(params: { password: string; ciphertext?: VaultCiphertext }): Promise<Uint8Array> {
    if (params.ciphertext) {
      this.#ciphertext = { ...params.ciphertext };
    }
    this.#unlocked = true;
    if (!this.#secret) {
      this.#secret = new Uint8Array([1, 2, 3]);
    }
    return new Uint8Array(this.#secret);
  }

  lock(): void {
    this.#unlocked = false;
  }

  exportKey(): Uint8Array {
    if (!this.#unlocked || !this.#secret) {
      throw new Error("locked");
    }
    return new Uint8Array(this.#secret);
  }

  async seal(params: { password: string; secret: Uint8Array }): Promise<VaultCiphertext> {
    this.#ciphertext = this.createCiphertext();
    this.#unlocked = true;
    this.#secret = new Uint8Array(params.secret);
    return { ...this.#ciphertext };
  }

  async reseal(params: { secret: Uint8Array }): Promise<VaultCiphertext> {
    this.#ciphertext = this.createCiphertext();
    this.#secret = new Uint8Array(params.secret);
    return { ...this.#ciphertext };
  }

  verifyPassword(password: string): Promise<void> {
    return Promise.resolve();
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

describe("createBackgroundServices", () => {
  it("hydrates controllers and session state from storage", async () => {
    const clock = () => 2_000;
    const storage = new MemoryStoragePort({
      snapshots: {
        [StorageNamespaces.Network]: NETWORK_SNAPSHOT,
        [StorageNamespaces.Accounts]: ACCOUNTS_SNAPSHOT,
        [StorageNamespaces.Permissions]: PERMISSIONS_SNAPSHOT,
        [StorageNamespaces.Approvals]: APPROVALS_SNAPSHOT,
        [StorageNamespaces.Transactions]: TRANSACTIONS_SNAPSHOT,
      },
      vaultMeta: VAULT_META,
    });

    const keyringStore = createInMemoryKeyringStore();

    const services = createServices({
      storage: { port: storage, now: clock, keyringStore },
      session: { vault: new FakeVault(clock, FAKE_CIPHERTEXT), persistDebounceMs: 0 },
      chainRegistry: { seed: [MAINNET_CHAIN, ALT_CHAIN] },
    });

    await services.lifecycle.initialize();

    const permissionState = services.controllers.permissions.getState();
    expect(permissionState.origins["https://dapp.example"]?.eip155?.chains).toEqual(["eip155:1"]);
    expect(permissionState.origins["https://dapp.example"]?.conflux?.chains).toEqual(["conflux:cfx"]);
    expect(permissionState.origins["https://dapp.example"]?.conflux?.scopes).toEqual([PermissionScopes.Sign]);

    const networkState = services.controllers.network.getState();
    expect(networkState.activeChain).toBe(NETWORK_SNAPSHOT.payload.activeChain);
    expect(networkState.knownChains.map((chain) => chain.chainRef).sort()).toEqual(
      NETWORK_SNAPSHOT.payload.knownChains.map((chain) => chain.chainRef).sort(),
    );
    expect(networkState.rpc).toEqual(NETWORK_SNAPSHOT.payload.rpc);

    expect(services.controllers.accounts.getActivePointer()?.address).toBe(ACCOUNTS_SNAPSHOT.payload.active?.address);

    expect(services.session.unlock.getState().timeoutMs).toBe(VAULT_META.payload.autoLockDuration);
    expect(services.session.getLastPersistedVaultMeta()).toStrictEqual(VAULT_META);

    services.lifecycle.destroy();
  });

  it("aligns the active account pointer with network chain changes", async () => {
    const services = createServices({
      chainRegistry: { seed: [MAINNET_CHAIN, ALT_CHAIN] },
    });

    await services.lifecycle.initialize();
    services.lifecycle.start();

    await services.controllers.network.addChain(ALT_CHAIN);

    const address = "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
    await services.controllers.accounts.addAccount({
      chainRef: MAINNET_CHAIN.chainRef,
      address,
      makePrimary: true,
    });
    await services.controllers.accounts.switchActive({ chainRef: MAINNET_CHAIN.chainRef, address });

    expect(services.controllers.accounts.getActivePointer()).toMatchObject({
      chainRef: MAINNET_CHAIN.chainRef,
      address,
    });

    await services.controllers.network.switchChain(ALT_CHAIN.chainRef);
    await flushMicrotasks();

    expect(services.controllers.accounts.getActivePointer()).toMatchObject({
      chainRef: ALT_CHAIN.chainRef,
      address,
      namespace: "eip155",
    });

    services.lifecycle.destroy();
  });

  it("persists controller snapshots when state changes", async () => {
    let now = 3_000;
    const clock = () => now;
    const storage = new MemoryStoragePort();
    const keyringStore = createInMemoryKeyringStore();

    const services = createServices({
      storage: { port: storage, now: clock, keyringStore },
      session: { vault: new FakeVault(clock, FAKE_CIPHERTEXT), persistDebounceMs: 0 },
      chainRegistry: { seed: [MAINNET_CHAIN] },
    });

    await services.lifecycle.initialize();
    services.lifecycle.start();

    now = 3_500;
    await services.controllers.chainRegistry.upsertChain({
      ...ALT_CHAIN,
      rpcEndpoints: [{ url: "https://rpc.alt.updated", type: "public" }],
    });
    await services.controllers.network.switchChain(ALT_CHAIN.chainRef);
    await flushMicrotasks();

    const networkSnapshot = storage.getSnapshot(StorageNamespaces.Network);
    expect(networkSnapshot).not.toBeNull();
    expect(networkSnapshot?.updatedAt).toBe(3_500);
    expect(networkSnapshot?.payload.activeChain).toBe(ALT_CHAIN.chainRef);
    const updatedChain = networkSnapshot?.payload.knownChains.find((chain) => chain.chainRef === ALT_CHAIN.chainRef);
    expect(updatedChain?.rpcEndpoints[0]?.url).toBe("https://rpc.alt.updated");

    now = 3_750;
    services.controllers.accounts.replaceState({
      namespaces: {
        eip155: { all: ["0x123"], primary: "0x123" },
      },
      active: { namespace: "eip155", chainRef: "eip155:1", address: "0x123" },
    });

    const accountsSnapshot = storage.getSnapshot(StorageNamespaces.Accounts);
    expect(accountsSnapshot).not.toBeNull();
    expect(accountsSnapshot?.updatedAt).toBe(3_750);
    expect(accountsSnapshot?.payload.namespaces.eip155?.all).toEqual(["0x123"]);
    expect(accountsSnapshot?.payload.active?.address).toBe("0x123");

    now = 3_820;
    await services.controllers.permissions.grant("https://dapp.example", PermissionScopes.Basic, {
      chainRef: MAINNET_CHAIN.chainRef,
    });
    await services.controllers.permissions.grant("https://dapp.example", PermissionScopes.Sign, {
      namespace: "conflux",
      chainRef: "conflux:cfx",
    });

    const permissionsSnapshot = storage.getSnapshot(StorageNamespaces.Permissions);
    expect(permissionsSnapshot).not.toBeNull();
    expect(permissionsSnapshot?.updatedAt).toBe(3_820);
    expect(permissionsSnapshot?.payload.origins["https://dapp.example"]?.eip155?.chains).toEqual([
      MAINNET_CHAIN.chainRef,
    ]);
    expect(permissionsSnapshot?.payload.origins["https://dapp.example"]?.conflux?.chains).toEqual(["conflux:cfx"]);

    now = 3_900;
    const pendingTx = {
      id: "tx-test-1",
      namespace: "eip155",
      chainRef: "eip155:1",
      origin: "https://dapp.example",
      from: "0x1111111111111111111111111111111111111111",
      request: {
        namespace: "eip155",
        chainRef: "eip155:1",
        payload: {
          chainId: "0x1",
          from: "0x1111111111111111111111111111111111111111",
          to: "0x2222222222222222222222222222222222222222",
          value: "0x0",
          data: "0x",
        },
      },
      status: "pending",
      hash: null,
      receipt: null,
      error: null,
      userRejected: false,
      warnings: [],
      issues: [],
      createdAt: now,
      updatedAt: now,
    } satisfies TransactionMeta;
    services.controllers.transactions.replaceState({
      pending: [pendingTx],
      history: [],
    });

    const transactionsSnapshot = storage.getSnapshot(StorageNamespaces.Transactions);
    expect(transactionsSnapshot).not.toBeNull();
    expect(transactionsSnapshot?.updatedAt).toBe(3_900);
    expect(transactionsSnapshot?.payload.pending).toHaveLength(1);
    expect(transactionsSnapshot?.payload.pending[0]?.id).toBe("tx-test-1");

    services.lifecycle.destroy();
  });

  it("persists vault meta when session changes", async () => {
    let now = 4_000;
    const clock = () => now;
    const storage = new MemoryStoragePort();
    const keyringStore = createInMemoryKeyringStore();
    const services = createServices({
      storage: { port: storage, now: clock, keyringStore },
      session: { vault: new FakeVault(clock, FAKE_CIPHERTEXT), persistDebounceMs: 0 },
    });

    await services.lifecycle.initialize();
    services.lifecycle.start();

    now = 4_100;
    await services.session.vault.initialize({ password: "secret" });

    expect(storage.savedVaultMeta).not.toBeNull();
    expect(storage.savedVaultMeta?.payload.ciphertext).not.toBeNull();
    expect(storage.savedVaultMeta?.payload.initializedAt).toBe(4_100);

    now = 4_200;
    services.session.unlock.lock("manual");
    await services.session.persistVaultMeta();

    expect(storage.savedVaultMeta?.updatedAt).toBe(4_200);
    services.lifecycle.destroy();
  });

  it("restores unlock snapshot and schedules auto lock after re-initialize", async () => {
    const autoLockMs = 1_000;
    let now = 10_000;
    const clock = () => now;
    const storage = new MemoryStoragePort();
    const keyringStore = createInMemoryKeyringStore();
    const swallowLog = () => {};

    const first = createServices({
      storage: { port: storage, now: clock, keyringStore },
      session: { vault: new FakeVault(clock, FAKE_CIPHERTEXT), persistDebounceMs: 0, autoLockDuration: autoLockMs },
    });

    await first.lifecycle.initialize();
    first.lifecycle.start();

    await first.session.vault.initialize({ password: "secret" });
    await first.session.unlock.unlock({ password: "secret" });

    const unlockedState = first.session.unlock.getState();
    expect(unlockedState.isUnlocked).toBe(true);
    expect(unlockedState.nextAutoLockAt).not.toBeNull();
    const expectedDeadline = unlockedState.nextAutoLockAt as number;

    now = 10_200;
    await first.session.persistVaultMeta();
    first.lifecycle.destroy();

    const second = createServices({
      storage: { port: storage, now: clock, keyringStore },
      session: { vault: new FakeVault(clock, FAKE_CIPHERTEXT), persistDebounceMs: 0, autoLockDuration: autoLockMs },
    });

    await second.lifecycle.initialize();
    second.lifecycle.start();

    const restoredState = second.session.unlock.getState();
    expect(restoredState.isUnlocked).toBe(false);
    expect(restoredState.timeoutMs).toBe(autoLockMs);

    const persistedUnlock = second.session.getLastPersistedVaultMeta()?.payload.unlockState;
    expect(persistedUnlock).toBeDefined();
    expect(persistedUnlock?.isUnlocked).toBe(true);
    expect(persistedUnlock?.lastUnlockedAt).toBe(unlockedState.lastUnlockedAt);
    expect(persistedUnlock?.nextAutoLockAt).toBe(expectedDeadline);
    second.lifecycle.destroy();
  });

  it("clears corrupted snapshots and continues hydration", async () => {
    const clock = () => 42_000;
    const storage = new MemoryStoragePort({
      snapshots: {
        [StorageNamespaces.Network]: NETWORK_SNAPSHOT,
        [StorageNamespaces.Accounts]: ACCOUNTS_SNAPSHOT,
      },
    });
    const keyringStore = createInMemoryKeyringStore();
    storage.setSnapshotLoadFailure(StorageNamespaces.Network, new Error("boom"));

    const swallowLog = () => {};
    const first = createServices({
      storage: { port: storage, now: clock, keyringStore },
      session: { vault: new FakeVault(clock, FAKE_CIPHERTEXT), persistDebounceMs: 0 },
      chainRegistry: { seed: [MAINNET_CHAIN, ALT_CHAIN] },
    });
    await first.lifecycle.initialize();
    first.lifecycle.start();

    expect(first.controllers.accounts.getAccounts()).toEqual(ACCOUNTS_SNAPSHOT.payload.namespaces?.eip155?.all ?? []);
    expect(first.controllers.accounts.getActivePointer()?.address).toBe(
      ACCOUNTS_SNAPSHOT.payload.active?.address ?? null,
    );
    first.controllers.accounts.replaceState({
      namespaces: { eip155: { all: ["0x999"], primary: "0x999" } },
      active: { namespace: "eip155", chainRef: "eip155:1", address: "0x999" },
    });

    first.lifecycle.destroy();

    storage.clearSnapshotLoadFailure(StorageNamespaces.Network);
    await storage.saveSnapshot(StorageNamespaces.Network, NETWORK_SNAPSHOT);

    const second = createServices({
      storage: { port: storage, now: clock, keyringStore },
      session: { vault: new FakeVault(clock, FAKE_CIPHERTEXT), persistDebounceMs: 0 },
      chainRegistry: { seed: [MAINNET_CHAIN, ALT_CHAIN] },
    });

    await second.lifecycle.initialize();

    const networkState = second.controllers.network.getState();
    expect(networkState.activeChain).toBe(NETWORK_SNAPSHOT.payload.activeChain);
    expect(networkState.knownChains.map((chain) => chain.chainRef).sort()).toEqual(
      NETWORK_SNAPSHOT.payload.knownChains.map((chain) => chain.chainRef).sort(),
    );
    expect(networkState.rpc).toEqual(NETWORK_SNAPSHOT.payload.rpc);

    second.lifecycle.destroy();
  });

  it("replays storage listeners after restart", async () => {
    const now = 50_000;
    const clock = () => now;
    const storage = new MemoryStoragePort();
    const keyringStore = createInMemoryKeyringStore();
    const swallowLog = () => {};

    const first = createServices({
      storage: { port: storage, now: clock, keyringStore },
      session: { vault: new FakeVault(clock, FAKE_CIPHERTEXT), persistDebounceMs: 0 },
    });

    await first.lifecycle.initialize();
    first.lifecycle.start();

    await first.controllers.chainRegistry.upsertChain({
      ...ALT_CHAIN,
      rpcEndpoints: [{ url: "https://rpc.alt.updated", type: "public" }],
    });
    await first.controllers.network.switchChain(ALT_CHAIN.chainRef);
    await flushMicrotasks();

    expect(storage.savedSnapshots.some((entry) => entry.namespace === StorageNamespaces.Network)).toBe(true);

    first.lifecycle.destroy();
    storage.savedSnapshots.splice(0);

    const second = createServices({
      storage: { port: storage, now: clock, keyringStore },
      session: { vault: new FakeVault(clock, FAKE_CIPHERTEXT), persistDebounceMs: 0 },
      chainRegistry: { seed: [MAINNET_CHAIN] },
    });

    await second.lifecycle.initialize();
    second.lifecycle.start();

    second.controllers.accounts.replaceState({
      namespaces: { eip155: { all: ["0xabc"], primary: "0xabc" } },
      active: { namespace: "eip155", chainRef: "eip155:1", address: "0xabc" },
    });

    expect(storage.savedSnapshots.some((entry) => entry.namespace === StorageNamespaces.Accounts)).toBe(true);

    second.lifecycle.destroy();
  });

  it("debounces vault meta persistence before writing", async () => {
    let now = 70_000;
    const clock = () => now;
    const storage = new MemoryStoragePort();
    const keyringStore = createInMemoryKeyringStore();
    const swallowLog = () => {};

    let nextTimerId = 1;
    const scheduled = new Map<number, { timeout: number; handler: () => void }>();

    const setTimeoutStub = vi.fn<(handler: () => void, timeout: number) => ReturnType<typeof setTimeout>>(
      (handler, timeout) => {
        const id = nextTimerId++;
        scheduled.set(id, { timeout, handler });
        return id as unknown as ReturnType<typeof setTimeout>;
      },
    );
    const clearTimeoutStub = vi.fn<(id: ReturnType<typeof setTimeout>) => void>((id) => {
      scheduled.delete(Number(id));
    });

    const runTimer = (timeout: number) => {
      for (const [id, entry] of scheduled) {
        if (entry.timeout === timeout) {
          scheduled.delete(id);
          entry.handler();
          break;
        }
      }
    };

    const services = createServices({
      storage: { port: storage, now: clock, logger: swallowLog, keyringStore },
      session: {
        vault: new FakeVault(clock),
        persistDebounceMs: 100,
        timers: {
          setTimeout: setTimeoutStub as unknown as typeof setTimeout,
          clearTimeout: clearTimeoutStub as unknown as typeof clearTimeout,
        },
      },
    });

    await services.lifecycle.initialize();
    services.lifecycle.start();

    await services.session.vault.initialize({ password: "secret" });
    await services.session.unlock.unlock({ password: "secret" });
    runTimer(100);

    const beforeUpdate = storage.savedVaultMeta?.updatedAt ?? null;

    now = 70_500;
    services.session.unlock.lock("manual");

    expect(Array.from(scheduled.values()).some((entry) => entry.timeout === 100)).toBe(true);
    expect(storage.savedVaultMeta?.updatedAt ?? null).toBe(beforeUpdate);

    now = 70_600;
    runTimer(100);
    await Promise.resolve();

    expect(storage.savedVaultMeta?.updatedAt).toBe(70_600);
    expect(storage.savedVaultMeta?.payload.unlockState?.isUnlocked).toBe(false);

    services.lifecycle.destroy();
  });

  it("operates lifecycle without a storage port", async () => {
    const now = 90_000;
    const clock = () => now;

    const services = createServices({
      session: { vault: new FakeVault(clock), persistDebounceMs: 0, autoLockDuration: 500 },
    });

    await expect(services.lifecycle.initialize()).resolves.toBeUndefined();
    services.lifecycle.start();

    await services.session.vault.initialize({ password: "secret" });
    await services.session.unlock.unlock({ password: "secret" });

    expect(services.session.getLastPersistedVaultMeta()).toBeNull();

    services.lifecycle.destroy();
  });

  it("skips hydration when hydrate flag is false", async () => {
    const now = 100_000;
    const clock = () => now;
    const storage = new MemoryStoragePort({
      snapshots: {
        [StorageNamespaces.Network]: NETWORK_SNAPSHOT,
        [StorageNamespaces.Accounts]: ACCOUNTS_SNAPSHOT,
      },
      vaultMeta: VAULT_META,
    });
    const keyringStore = createInMemoryKeyringStore();
    const swallowLog = () => {};

    const services = createServices({
      storage: { port: storage, now: clock, logger: swallowLog, hydrate: false, keyringStore },
      session: { vault: new FakeVault(clock), persistDebounceMs: 0 },
    });

    await services.lifecycle.initialize();
    services.lifecycle.start();

    expect(services.controllers.network.getActiveChain().chainRef).toBe(MAINNET_CHAIN.chainRef);
    expect(services.controllers.accounts.getActivePointer()?.address).toBeNull();
    expect(services.session.getLastPersistedVaultMeta()).toBeNull();

    services.controllers.network.replaceState(NETWORK_SNAPSHOT.payload);
    services.session.unlock.lock("manual");
    await services.session.persistVaultMeta();

    expect(storage.savedSnapshots.some((entry) => entry.namespace === StorageNamespaces.Network)).toBe(true);
    expect(storage.savedVaultMeta).not.toBeNull();

    services.lifecycle.destroy();
  });

  it("derives and removes accounts through accountsRuntime bridge", async () => {
    const services = createServices();

    await services.lifecycle.initialize();
    services.lifecycle.start();

    try {
      await services.session.vault.initialize({ password: "test" });
      await services.session.unlock.unlock({ password: "test" });

      const { keyringId } = await services.keyring.confirmNewMnemonic(TEST_MNEMONIC);

      const chain = services.controllers.network.getActiveChain();
      const { account, namespaceState } = await services.accountsRuntime.deriveAccount({
        namespace: chain.namespace,
        chainRef: chain.chainRef,
        keyringId,
        makePrimary: true,
        switchActive: true,
      });

      await flushMicrotasks();

      expect(namespaceState.all).toContain(account.address);
      expect(services.controllers.accounts.getActivePointer()).toMatchObject({
        namespace: chain.namespace,
        chainRef: chain.chainRef,
        address: account.address,
      });

      await services.accountsRuntime.removeAccount({
        namespace: chain.namespace,
        chainRef: chain.chainRef,
        address: account.address,
      });

      await flushMicrotasks();

      const afterRemoval = services.controllers.accounts.getState().namespaces[chain.namespace];
      expect(afterRemoval?.all ?? []).not.toContain(account.address);
    } finally {
      services.lifecycle.destroy();
    }
  });

  it("keeps provided registry entries and adds default eip155 when missing", async () => {
    const registry = new TransactionAdapterRegistry();
    const confluxAdapter = makeAdapter("cfx");
    registry.register("conflux", confluxAdapter);

    const services = createServices({ transactions: { registry } });

    await services.lifecycle.initialize();
    expect(registry.get("conflux")).toBe(confluxAdapter);
    expect(registry.get(EIP155_NAMESPACE)).toBeDefined();

    services.lifecycle.destroy();
  });

  it("does not override a provided eip155 adapter", async () => {
    const registry = new TransactionAdapterRegistry();
    const customEip155 = makeAdapter("custom");
    registry.register(EIP155_NAMESPACE, customEip155);

    const services = createServices({ transactions: { registry } });

    await services.lifecycle.initialize();
    expect(registry.get(EIP155_NAMESPACE)).toBe(customEip155);

    services.lifecycle.destroy();
  });

  it("exposes rpc client registry with default eip155 client", async () => {
    const fetch = vi.fn(async () => new Response(JSON.stringify({ result: "0x1" }), { status: 200 }));
    const services = createServices({
      rpcClients: { options: { fetch } },
      chainRegistry: { seed: [MAINNET_CHAIN] },
    });

    await services.lifecycle.initialize();

    const client = services.rpcClients.getClient<Eip155RpcCapabilities>("eip155", MAINNET_CHAIN.chainRef);
    await expect(client.request({ method: "eth_chainId" })).resolves.toBe("0x1");
    expect(fetch).toHaveBeenCalledTimes(1);

    services.lifecycle.destroy();
  });
});
