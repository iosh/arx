import { describe, expect, it } from "vitest";
import { PermissionScopes } from "../controllers/index.js";
import type { StorageNamespace, StoragePort, StorageSnapshotMap, VaultMetaSnapshot } from "../storage/index.js";
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
import type { VaultCiphertext, VaultService } from "../vault/types.js";
import { createBackgroundServices } from "./createBackgroundServices.js";

const MAINNET_CHAIN = {
  caip2: "eip155:1",
  chainId: "0x1",
  rpcUrl: "https://rpc.mainnet",
  name: "Ethereum",
  nativeCurrency: {
    name: "Ether",
    symbol: "ETH",
    decimals: 18,
  },
};

const ALT_CHAIN = {
  caip2: "eip155:10",
  chainId: "0xa",
  rpcUrl: "https://rpc.alt",
  name: "Alt Chain",
  nativeCurrency: {
    name: "Alter",
    symbol: "ALT",
    decimals: 18,
  },
};

const NETWORK_SNAPSHOT: NetworkSnapshot = {
  version: NETWORK_SNAPSHOT_VERSION,
  updatedAt: 1_000,
  payload: {
    active: ALT_CHAIN,
    knownChains: [ALT_CHAIN, MAINNET_CHAIN],
  },
};

const ACCOUNTS_SNAPSHOT: AccountsSnapshot = {
  version: ACCOUNTS_SNAPSHOT_VERSION,
  updatedAt: 1_000,
  payload: {
    all: ["0xabc", "0xdef"],
    primary: "0xabc",
  },
};

const PERMISSIONS_SNAPSHOT: PermissionsSnapshot = {
  version: PERMISSIONS_SNAPSHOT_VERSION,
  updatedAt: 1_000,
  payload: {
    origins: {
      "https://dapp.example": [PermissionScopes.Basic, PermissionScopes.Accounts],
    },
  },
};

const APPROVALS_SNAPSHOT: ApprovalsSnapshot = {
  version: APPROVALS_SNAPSHOT_VERSION,
  updatedAt: 1_000,
  payload: {
    pending: ["approval-1"],
  },
};

const TRANSACTIONS_SNAPSHOT: TransactionsSnapshot = {
  version: TRANSACTIONS_SNAPSHOT_VERSION,
  updatedAt: 1_000,
  payload: {
    pending: [
      {
        id: "tx-1",
        caip2: "eip155:1",
        origin: "https://dapp.example",
        from: "0xabc",
        request: {
          namespace: "eip155",
          caip2: "eip155:1",
          payload: {
            chainId: "0x1",
            from: "0xabc",
            to: "0xdef",
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

class MemoryStoragePort implements StoragePort {
  private readonly snapshots = new Map<StorageNamespace, StorageSnapshotMap[StorageNamespace]>();
  private vaultMeta: VaultMetaSnapshot | null;
  public readonly savedSnapshots: Array<{
    namespace: StorageNamespace;
    envelope: StorageSnapshotMap[StorageNamespace];
  }> = [];
  public savedVaultMeta: VaultMetaSnapshot | null = null;

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

  getSnapshot<TNamespace extends StorageNamespace>(namespace: TNamespace): StorageSnapshotMap[TNamespace] | null {
    return (this.snapshots.get(namespace) as StorageSnapshotMap[TNamespace]) ?? null;
  }

  getVaultMeta() {
    return this.vaultMeta;
  }

  async loadSnapshot<TNamespace extends StorageNamespace>(
    namespace: TNamespace,
  ): Promise<StorageSnapshotMap[TNamespace] | null> {
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
      throw new Error("locked");
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

    const services = createBackgroundServices({
      storage: { port: storage, now: clock },
      session: { vault: new FakeVault(clock, FAKE_CIPHERTEXT), persistDebounceMs: 0 },
    });

    await services.lifecycle.initialize();

    expect(services.controllers.network.getState()).toStrictEqual(NETWORK_SNAPSHOT.payload);
    expect(services.controllers.accounts.getPrimaryAccount()).toBe(ACCOUNTS_SNAPSHOT.payload.primary);
    expect(services.controllers.permissions.getState()).toStrictEqual(PERMISSIONS_SNAPSHOT.payload);
    expect(services.controllers.approvals.getState()).toStrictEqual(APPROVALS_SNAPSHOT.payload);
    expect(services.controllers.transactions.getState()).toStrictEqual(TRANSACTIONS_SNAPSHOT.payload);

    expect(services.session.unlock.getState().timeoutMs).toBe(VAULT_META.payload.autoLockDuration);
    expect(services.session.getLastPersistedVaultMeta()).toStrictEqual(VAULT_META);

    services.lifecycle.destroy();
  });

  it("persists controller snapshots when state changes", async () => {
    let now = 3_000;
    const clock = () => now;
    const storage = new MemoryStoragePort();

    const services = createBackgroundServices({
      storage: { port: storage, now: clock },
      session: { vault: new FakeVault(clock), persistDebounceMs: 0 },
    });

    await services.lifecycle.initialize();
    services.lifecycle.start();

    now = 3_500;
    await services.controllers.network.addChain(
      {
        ...ALT_CHAIN,
        rpcUrl: "https://rpc.alt.updated",
      },
      { activate: true, replaceExisting: true },
    );

    const networkSnapshot = storage.getSnapshot(StorageNamespaces.Network);
    expect(networkSnapshot).not.toBeNull();
    expect(networkSnapshot?.updatedAt).toBe(3_500);
    expect(networkSnapshot?.payload.active.rpcUrl).toBe("https://rpc.alt.updated");

    now = 3_750;
    services.controllers.accounts.replaceState({ all: ["0x123"], primary: "0x123" });

    const accountsSnapshot = storage.getSnapshot(StorageNamespaces.Accounts);
    expect(accountsSnapshot).not.toBeNull();
    expect(accountsSnapshot?.updatedAt).toBe(3_750);
    expect(accountsSnapshot?.payload.all).toEqual(["0x123"]);

    services.lifecycle.destroy();
  });

  it("persists vault meta when session changes", async () => {
    let now = 4_000;
    const clock = () => now;
    const storage = new MemoryStoragePort();
    const services = createBackgroundServices({
      storage: { port: storage, now: clock },
      session: { vault: new FakeVault(clock), persistDebounceMs: 0 },
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
});
