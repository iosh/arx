import { describe, expect, it } from "vitest";
import { normalizeEvmAddress } from "../../chains/index.js";
import type { AccountController, MultiNamespaceAccountsState } from "../../controllers/account/types.js";
import type { UnlockController, UnlockLockedPayload, UnlockUnlockedPayload } from "../../controllers/unlock/types.js";
import { keyringErrors } from "../../errors/keyring.js";
import { vaultErrors } from "../../errors/vault.js";
import { EthereumHdKeyring, PrivateKeyKeyring } from "../../keyring/index.js";
import type { AccountMeta, KeyringMeta } from "../../storage/keyringSchemas.js";
import type { KeyringStorePort } from "../../storage/keyringStore.js";
import type { VaultService } from "../../vault/types.js";
import { KeyringService } from "./KeyringService.js";

const MNEMONIC = "test test test test test test test test test test test junk";
const EIP155_NAMESPACE = "eip155";
const PRIVATE_KEY = "0xc83c5a4a2353021a9bf912a7cf8f053fde951355514868f3e75e085cad7490a1";
const ENVELOPE_VERSION = 1;

const encoder = new TextEncoder();
const decoder = new TextDecoder();

class FakeVault implements Pick<VaultService, "exportKey" | "getStatus" | "isUnlocked"> {
  constructor(
    private payloadBytes: Uint8Array,
    private unlocked = true,
    private password = "test",
  ) {}
  exportKey(): Uint8Array {
    return new Uint8Array(this.payloadBytes);
  }
  getStatus() {
    return { isUnlocked: this.unlocked, hasCiphertext: true };
  }
  isUnlocked(): boolean {
    return this.unlocked;
  }
  setUnlocked(next: boolean) {
    this.unlocked = next;
  }
  setPayload(bytes: Uint8Array) {
    this.payloadBytes = new Uint8Array(bytes);
  }
  async verifyPassword(password: string) {
    if (password !== this.password) {
      throw vaultErrors.invalidPassword();
    }
  }
}

class FakeUnlock implements Pick<UnlockController, "onUnlocked" | "onLocked" | "isUnlocked"> {
  #unlockedHandlers = new Set<(payload: UnlockUnlockedPayload) => void>();
  #lockedHandlers = new Set<(payload: UnlockLockedPayload) => void>();
  constructor(private unlocked = true) {}
  isUnlocked(): boolean {
    return this.unlocked;
  }
  onUnlocked(handler: (payload: UnlockUnlockedPayload) => void): () => void {
    this.#unlockedHandlers.add(handler);
    return () => this.#unlockedHandlers.delete(handler);
  }
  onLocked(handler: (payload: UnlockLockedPayload) => void): () => void {
    this.#lockedHandlers.add(handler);
    return () => this.#lockedHandlers.delete(handler);
  }
  emitUnlocked(payload: UnlockUnlockedPayload) {
    this.unlocked = true;
    for (const handler of this.#unlockedHandlers) handler(payload);
  }
  emitLocked(payload: UnlockLockedPayload) {
    this.unlocked = false;
    for (const handler of this.#lockedHandlers) handler(payload);
  }
}

class MemoryAccountsController implements Pick<AccountController, "getState" | "replaceState"> {
  #state: MultiNamespaceAccountsState = { namespaces: {}, active: null };
  getState(): MultiNamespaceAccountsState {
    return structuredClone(this.#state);
  }
  replaceState(next: MultiNamespaceAccountsState): void {
    this.#state = structuredClone(next);
  }
}

const flushAsync = async () => {
  await Promise.resolve();
  await Promise.resolve();
};

const baseNamespaces = [
  {
    namespace: EIP155_NAMESPACE,
    normalizeAddress: normalizeEvmAddress,
    factories: {
      hd: () => new EthereumHdKeyring(),
      "private-key": () => new PrivateKeyKeyring(),
    },
  },
] as const;

const createInMemoryKeyringStore = () => {
  let keyrings: KeyringMeta[] = [];
  let accounts: AccountMeta[] = [];
  return {
    async getKeyringMetas() {
      return [...keyrings];
    },
    async getAccountMetas() {
      return [...accounts];
    },
    async putKeyringMetas(metas: KeyringMeta[]) {
      keyrings = metas.map((m) => ({ ...m }));
    },
    async putAccountMetas(metas: AccountMeta[]) {
      accounts = metas.map((m) => ({ ...m }));
    },
    async deleteKeyringMeta(id: string) {
      keyrings = keyrings.filter((k) => k.id !== id);
      accounts = accounts.filter((a) => a.keyringId !== id);
    },
    async deleteAccount(address: string) {
      accounts = accounts.filter((a) => a.address !== address);
    },
    async deleteAccountsByKeyring(keyringId: string) {
      accounts = accounts.filter((a) => a.keyringId !== keyringId);
    },
  } as KeyringStorePort;
};

const buildHdPayload = (accountCount: number, keyringId = "10000000-0000-4000-8000-000000000001") => {
  const keyring = new EthereumHdKeyring();
  keyring.loadFromMnemonic(MNEMONIC);
  for (let i = 0; i < accountCount; i += 1) keyring.deriveNextAccount();
  return {
    payloadBytes: encoder.encode(
      JSON.stringify({
        keyrings: [
          {
            keyringId,
            type: "hd",
            createdAt: Date.now(),
            version: 1,
            namespace: EIP155_NAMESPACE,
            payload: { mnemonic: MNEMONIC.split(" "), passphrase: undefined },
          },
        ],
      }),
    ),
    metas: {
      keyring: { id: keyringId, type: "hd" as const, createdAt: Date.now(), derivedCount: accountCount },
      accounts: keyring.getAccounts().map((acc, idx) => ({
        address: normalizeEvmAddress(acc.address),
        keyringId,
        derivationIndex: idx,
        createdAt: Date.now(),
      })),
    },
  };
};

describe("KeyringService", () => {
  it("hydrates hd keyring from vault payload", async () => {
    const { payloadBytes, metas } = buildHdPayload(2);
    const vault = new FakeVault(payloadBytes);
    const unlock = new FakeUnlock(true);
    const accounts = new MemoryAccountsController();
    const keyringStore = createInMemoryKeyringStore();
    await keyringStore.putKeyringMetas([metas.keyring]);
    await keyringStore.putAccountMetas(metas.accounts);

    const service = new KeyringService({ vault, unlock, accounts, keyringStore, namespaces: [...baseNamespaces] });
    await service.attach();

    expect(service.getKeyrings()).toHaveLength(1);
    expect(accounts.getState().namespaces[EIP155_NAMESPACE]?.all).toHaveLength(2);
  });

  it("derives next account and updates envelope/state", async () => {
    const { payloadBytes, metas } = buildHdPayload(1);
    const keyringStore = createInMemoryKeyringStore();
    await keyringStore.putKeyringMetas([metas.keyring]);
    await keyringStore.putAccountMetas(metas.accounts);
    const vault = new FakeVault(payloadBytes);
    const unlock = new FakeUnlock(true);
    const accounts = new MemoryAccountsController();
    const service = new KeyringService({ vault, unlock, accounts, keyringStore, namespaces: [...baseNamespaces] });
    await service.attach();

    const hdMeta = service.getKeyrings().find((k) => k.type === "hd")!;
    const derived = await service.deriveAccount(hdMeta.id);
    expect(accounts.getState().namespaces[EIP155_NAMESPACE]?.all).toContain(normalizeEvmAddress(derived.address));
  });

  it("creates hd keyring when unlocked", async () => {
    const vault = new FakeVault(encoder.encode(JSON.stringify({ keyrings: [] })), true); // unlocked
    const unlock = new FakeUnlock(true); // isUnlocked = true
    const accounts = new MemoryAccountsController();
    const keyringStore = createInMemoryKeyringStore();

    const service = new KeyringService({ vault, unlock, accounts, keyringStore, namespaces: [...baseNamespaces] });

    const { keyringId, address } = await service.confirmNewMnemonic(MNEMONIC);
    expect(keyringId).toBeDefined();
    expect(accounts.getState().namespaces[EIP155_NAMESPACE]?.all).toContain(address);
  });

  it("imports private-key keyring, prevents duplicates, and syncs state", async () => {
    const vault = new FakeVault(encoder.encode(JSON.stringify({ keyrings: [] })), true);
    const unlock = new FakeUnlock(true);
    const accounts = new MemoryAccountsController();
    const keyringStore = createInMemoryKeyringStore();
    const service = new KeyringService({ vault, unlock, accounts, keyringStore, namespaces: [...baseNamespaces] });
    await service.attach();

    const { keyringId, account } = await service.importPrivateKey(PRIVATE_KEY, { namespace: EIP155_NAMESPACE });
    expect(service.getKeyrings().filter((k) => k.type === "private-key")).toHaveLength(1);
    expect(accounts.getState().namespaces[EIP155_NAMESPACE]?.all).toContain(normalizeEvmAddress(account.address));
    await expect(() => service.importPrivateKey(PRIVATE_KEY, { namespace: EIP155_NAMESPACE })).rejects.toThrowError(
      keyringErrors.duplicateAccount().message,
    );
  });

  it("removes private-key keyring when its account is removed", async () => {
    const vault = new FakeVault(encoder.encode(""), true);
    const unlock = new FakeUnlock(true);
    const accounts = new MemoryAccountsController();
    const keyringStore = createInMemoryKeyringStore();
    const service = new KeyringService({ vault, unlock, accounts, keyringStore, namespaces: [...baseNamespaces] });
    const { keyringId, account } = await service.importPrivateKey(PRIVATE_KEY, { namespace: EIP155_NAMESPACE });
    await service.removePrivateKeyKeyring(keyringId);
    expect(service.getKeyrings().filter((k) => k.type === "private-key")).toHaveLength(0);
  });

  it("clears on lock and rehydrates on unlock", async () => {
    const { payloadBytes, metas } = buildHdPayload(2);
    const keyringStore = createInMemoryKeyringStore();
    await keyringStore.putKeyringMetas([metas.keyring]);
    await keyringStore.putAccountMetas(metas.accounts);
    const vault = new FakeVault(payloadBytes, true);
    const unlock = new FakeUnlock(true);
    const accounts = new MemoryAccountsController();
    const service = new KeyringService({ vault, unlock, accounts, keyringStore, namespaces: [...baseNamespaces] });
    await service.attach();

    unlock.emitLocked({ at: Date.now(), reason: "manual" });

    await flushAsync();
    expect(service.getKeyrings()).toHaveLength(0);

    const next = buildHdPayload(3, "2000-...");
    await keyringStore.putKeyringMetas([next.metas.keyring]);
    await keyringStore.putAccountMetas(next.metas.accounts);
    vault.setPayload(next.payloadBytes);
    vault.setUnlocked(true);
    unlock.emitUnlocked({ at: Date.now() });
    await flushAsync();
    expect(service.getKeyrings()).toHaveLength(1);
    expect(accounts.getState().namespaces[EIP155_NAMESPACE]?.all).toHaveLength(3);
  });

  it("exports mnemonic with password and rejects invalid password", async () => {
    const { payloadBytes, metas } = buildHdPayload(1);
    const vault = new FakeVault(payloadBytes, true, "secret");
    const unlock = new FakeUnlock(true);
    const accounts = new MemoryAccountsController();
    const keyringStore = createInMemoryKeyringStore();
    await keyringStore.putKeyringMetas([metas.keyring]);
    await keyringStore.putAccountMetas(metas.accounts);
    const service = new KeyringService({ vault, unlock, accounts, keyringStore, namespaces: [...baseNamespaces] });
    await service.attach();
    await flushAsync();
    const hdMeta = service.getKeyrings().find((k) => k.type === "hd")!;
    await expect(service.exportMnemonic(hdMeta.id, "secret")).resolves.toBe(MNEMONIC);
    await expect(service.exportMnemonic(hdMeta.id, "wrong")).rejects.toThrowError(
      vaultErrors.invalidPassword().message,
    );
  });

  it("exports private key with password and rejects invalid password", async () => {
    const vault = new FakeVault(encoder.encode(JSON.stringify({ keyrings: [] })), true, "secret");
    const unlock = new FakeUnlock(true);
    const accounts = new MemoryAccountsController();
    const keyringStore = createInMemoryKeyringStore();
    const service = new KeyringService({ vault, unlock, accounts, keyringStore, namespaces: [...baseNamespaces] });
    await service.attach();
    await flushAsync();
    const { account } = await service.importPrivateKey(PRIVATE_KEY, { namespace: EIP155_NAMESPACE });
    await expect(service.exportPrivateKey(EIP155_NAMESPACE, account.address, "secret")).resolves.toBeInstanceOf(
      Uint8Array,
    );
    await expect(service.exportPrivateKey(EIP155_NAMESPACE, account.address, "wrong")).rejects.toThrowError(
      vaultErrors.invalidPassword().message,
    );
  });

  it("respects skipBackup flag and markBackedUp updates meta", async () => {
    const vault = new FakeVault(encoder.encode(JSON.stringify({ keyrings: [] })), true);
    const unlock = new FakeUnlock(true);
    const accounts = new MemoryAccountsController();
    const keyringStore = createInMemoryKeyringStore();
    const service = new KeyringService({ vault, unlock, accounts, keyringStore, namespaces: [...baseNamespaces] });

    const { keyringId } = await service.confirmNewMnemonic(MNEMONIC, { skipBackup: true });
    expect(service.getKeyrings().find((k) => k.id === keyringId)?.backedUp).toBe(false);

    await service.markBackedUp(keyringId);
    expect(service.getKeyrings().find((k) => k.id === keyringId)?.backedUp).toBe(true);
  });

  it("renames keyring and account, hides/unhides account", async () => {
    const { payloadBytes, metas } = buildHdPayload(1);
    const vault = new FakeVault(payloadBytes, true);
    const unlock = new FakeUnlock(true);
    const accounts = new MemoryAccountsController();
    const keyringStore = createInMemoryKeyringStore();
    await keyringStore.putKeyringMetas([metas.keyring]);
    await keyringStore.putAccountMetas(metas.accounts);
    const service = new KeyringService({ vault, unlock, accounts, keyringStore, namespaces: [...baseNamespaces] });
    await service.attach();

    const hdMeta = service.getKeyrings().find((k) => k.type === "hd")!;
    const firstAccount = service.getAccounts(true)[0]!;
    await service.renameKeyring(hdMeta.id, "main");
    await service.renameAccount(firstAccount.address, "acct1");
    expect(service.getKeyrings().find((k) => k.id === hdMeta.id)?.alias).toBe("main");
    expect(service.getAccounts(true).find((a) => a.address === firstAccount.address)?.alias).toBe("acct1");

    await service.hideHdAccount(firstAccount.address);
    expect(service.getAccounts(false).find((a) => a.address === firstAccount.address)).toBeUndefined();
    await service.unhideHdAccount(firstAccount.address);
    expect(service.getAccounts(false).find((a) => a.address === firstAccount.address)).toBeDefined();
  });

  it("imports 24-word mnemonic", async () => {
    const MNEMONIC_24 =
      "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon art";
    const vault = new FakeVault(encoder.encode(JSON.stringify({ keyrings: [] })), true);
    const unlock = new FakeUnlock(true);
    const accounts = new MemoryAccountsController();
    const keyringStore = createInMemoryKeyringStore();
    const service = new KeyringService({ vault, unlock, accounts, keyringStore, namespaces: [...baseNamespaces] });
    const { keyringId } = await service.confirmNewMnemonic(MNEMONIC_24);
    expect(service.getKeyrings().find((k) => k.id === keyringId)).toBeDefined();
  });
});
