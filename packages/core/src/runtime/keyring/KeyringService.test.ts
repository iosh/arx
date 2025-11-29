import { describe, expect, it } from "vitest";
import { normalizeEvmAddress } from "../../chains/index.js";
import type { AccountController, MultiNamespaceAccountsState } from "../../controllers/account/types.js";
import type { UnlockController, UnlockLockedPayload, UnlockUnlockedPayload } from "../../controllers/unlock/types.js";
import { keyringErrors } from "../../errors/keyring.js";
import { EthereumHdKeyring, PrivateKeyKeyring } from "../../keyring/index.js";
import type { VaultService } from "../../vault/types.js";
import { KeyringService } from "./KeyringService.js";

const MNEMONIC = "test test test test test test test test test test test junk";
const EIP155_NAMESPACE = "eip155";
const PRIVATE_KEY = "0xc83c5a4a2353021a9bf912a7cf8f053fde951355514868f3e75e085cad7490a1";
const ENVELOPE_VERSION = 1;

const encoder = new TextEncoder();
const decoder = new TextDecoder();

const buildHdEnvelope = (accountCount: number, keyringId = "10000000-0000-4000-8000-000000000001") => {
  const keyring = new EthereumHdKeyring();
  keyring.loadFromMnemonic(MNEMONIC);
  for (let i = 0; i < accountCount; i += 1) {
    keyring.deriveNextAccount();
  }
  const snapshot = keyring.toSnapshot();
  return encoder.encode(
    JSON.stringify({
      version: ENVELOPE_VERSION, // 1
      namespaces: {
        [EIP155_NAMESPACE]: {
          keyrings: [
            {
              id: keyringId,
              kind: "hd",
              createdAt: Date.now(),
              secret: { type: "hd", mnemonic: MNEMONIC },
              snapshot,
            },
          ],
        },
      },
    }),
  );
};

class FakeVault implements Pick<VaultService, "exportKey" | "getStatus" | "isUnlocked"> {
  constructor(
    private envelopeBytes: Uint8Array,
    private unlocked = true,
  ) {}
  exportKey(): Uint8Array {
    return new Uint8Array(this.envelopeBytes);
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
  setEnvelope(bytes: Uint8Array) {
    this.envelopeBytes = new Uint8Array(bytes);
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

describe("KeyringService", () => {
  it("hydrates hd keyring from vault envelope on attach", async () => {
    const vault = new FakeVault(buildHdEnvelope(2));
    const unlock = new FakeUnlock(true);
    const accounts = new MemoryAccountsController();

    const service = new KeyringService({
      vault,
      unlock,
      accounts,
      namespaces: [...baseNamespaces],
      logger: (message, error) => {
        console.log("[KeyringService]", message, error);
      },
    });
    await service.attach();

    const keyrings = service.listKeyrings(EIP155_NAMESPACE);
    expect(keyrings).toHaveLength(1);
    expect(keyrings[0]!.kind).toBe("hd");
    expect(accounts.getState().namespaces[EIP155_NAMESPACE]?.all).toHaveLength(2);
  });

  it("derives next account and updates envelope/state", async () => {
    const vault = new FakeVault(buildHdEnvelope(1));
    const unlock = new FakeUnlock(true);
    const accounts = new MemoryAccountsController();

    const service = new KeyringService({ vault, unlock, accounts, namespaces: [...baseNamespaces] });
    await service.attach();

    const hd = service.listKeyrings(EIP155_NAMESPACE).find((k) => k.kind === "hd");
    expect(hd).toBeDefined();

    const derived = service.deriveNextAccount(EIP155_NAMESPACE, hd!.id);
    expect(derived.address).toMatch(/^0x[0-9a-f]{40}$/);

    expect(accounts.getState().namespaces[EIP155_NAMESPACE]?.all).toContain(normalizeEvmAddress(derived.address));

    const envelopeBytes = service.getEnvelope();
    expect(envelopeBytes).not.toBeNull();
    const parsed = JSON.parse(decoder.decode(envelopeBytes!));
    const snapshot = parsed.namespaces[EIP155_NAMESPACE].keyrings.find((k: { id: string }) => k.id === hd!.id).snapshot;
    expect(snapshot.accounts.length).toBeGreaterThanOrEqual(2);
    expect(snapshot.nextDerivationIndex).toBeGreaterThanOrEqual(2);
  });

  it("creates hd keyring when vault is locked", () => {
    const vault = new FakeVault(encoder.encode(""), false);
    const unlock = new FakeUnlock(false);
    const accounts = new MemoryAccountsController();

    const service = new KeyringService({ vault, unlock, accounts, namespaces: [...baseNamespaces] });
    const { keyringId, accounts: derived } = service.createHdKeyring(EIP155_NAMESPACE, { mnemonic: MNEMONIC });

    expect(keyringId).toBeDefined();
    expect(derived.length).toBeGreaterThan(0);
    expect(accounts.getState().namespaces[EIP155_NAMESPACE]?.all.length).toBe(derived.length);

    const envelope = service.getEnvelope();
    expect(envelope).not.toBeNull();
    const decoded = JSON.parse(decoder.decode(envelope!));
    expect(decoded.version).toBe(ENVELOPE_VERSION);
    expect(decoded.namespaces[EIP155_NAMESPACE]?.keyrings).toBeDefined();
  });

  it("imports private-key keyring, prevents duplicates, and syncs state", async () => {
    const vault = new FakeVault(encoder.encode(""), true);
    const unlock = new FakeUnlock(true);
    const accounts = new MemoryAccountsController();

    const service = new KeyringService({ vault, unlock, accounts, namespaces: [...baseNamespaces] });
    await service.attach();

    const { keyringId, account } = service.importPrivateKey(EIP155_NAMESPACE, { privateKey: PRIVATE_KEY });
    expect(keyringId).toBeDefined();
    const keyrings = service.listKeyrings(EIP155_NAMESPACE).filter((k) => k.kind === "private-key");
    expect(keyrings).toHaveLength(1);

    const nsState = accounts.getState().namespaces[EIP155_NAMESPACE];
    expect(nsState?.all).toContain(normalizeEvmAddress(account.address));

    expect(() => service.importPrivateKey(EIP155_NAMESPACE, { privateKey: PRIVATE_KEY })).toThrowError(
      keyringErrors.duplicateAccount().message,
    );
  });

  it("removes private-key keyring when its account is removed", () => {
    const vault = new FakeVault(encoder.encode(""), true);
    const unlock = new FakeUnlock(true);
    const accounts = new MemoryAccountsController();

    const service = new KeyringService({ vault, unlock, accounts, namespaces: [...baseNamespaces] });
    const { keyringId, account } = service.importPrivateKey(EIP155_NAMESPACE, { privateKey: PRIVATE_KEY });

    service.removeAccount(EIP155_NAMESPACE, keyringId, account.address);
    const keyrings = service.listKeyrings(EIP155_NAMESPACE).filter((k) => k.kind === "private-key");
    expect(keyrings).toHaveLength(0);
  });

  it("clears on lock and rehydrates on unlock", async () => {
    const vault = new FakeVault(buildHdEnvelope(2));
    const unlock = new FakeUnlock(true);
    const accounts = new MemoryAccountsController();

    const service = new KeyringService({ vault, unlock, accounts, namespaces: [...baseNamespaces] });
    await service.attach();

    expect(service.listKeyrings(EIP155_NAMESPACE)).toHaveLength(1);

    vault.setUnlocked(false);
    unlock.emitLocked({ at: Date.now(), reason: "manual" });
    await flushAsync();

    expect(service.listKeyrings(EIP155_NAMESPACE)).toHaveLength(0);
    expect(service.getEnvelope()).toBeNull();

    const nextEnvelope = buildHdEnvelope(3, "20000000-0000-4000-8000-000000000002");
    vault.setEnvelope(nextEnvelope);
    vault.setUnlocked(true);
    unlock.emitUnlocked({ at: Date.now() });
    await flushAsync();

    const keyrings = service.listKeyrings(EIP155_NAMESPACE);
    expect(keyrings).toHaveLength(1);
    expect(accounts.getState().namespaces[EIP155_NAMESPACE]?.all).toHaveLength(3);
  });
});
