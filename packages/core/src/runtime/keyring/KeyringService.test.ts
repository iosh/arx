import { describe, expect, it } from "vitest";
import type { AccountController, MultiNamespaceAccountsState } from "../../controllers/account/types.js";
import type { UnlockController, UnlockLockedPayload, UnlockUnlockedPayload } from "../../controllers/unlock/types.js";
import { EthereumHdKeyring } from "../../keyring/index.js";
import type { VaultService } from "../../vault/types.js";
import { KeyringService } from "./KeyringService.js";

const MNEMONIC = "test walk nut penalty hip pave soap entry language right filter choice";
const EIP155_NAMESPACE = "eip155";
const PRIVATE_KEY = "0xc83c5a4a2353021a9bf912a7cf8f053fde951355514868f3e75e085cad7490a1";

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

const createEnvelope = (accountCount: number) => {
  const keyring = new EthereumHdKeyring();
  keyring.loadFromMnemonic(MNEMONIC);
  for (let index = 0; index < accountCount; index += 1) {
    keyring.deriveNextAccount();
  }
  const snapshot = keyring.toSnapshot();
  return {
    version: 1,
    namespaces: {
      [EIP155_NAMESPACE]: {
        type: "hierarchical" as const,
        mnemonic: MNEMONIC,
        snapshot,
      },
    },
  };
};

class FakeVault implements Pick<VaultService, "exportKey" | "getStatus" | "isUnlocked"> {
  constructor(
    private readonly envelopeBytes: Uint8Array,
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
    for (const handler of this.#unlockedHandlers) {
      handler(payload);
    }
  }

  emitLocked(payload: UnlockLockedPayload) {
    this.unlocked = false;
    for (const handler of this.#lockedHandlers) {
      handler(payload);
    }
  }
}

class MemoryAccountsController implements Pick<AccountController, "getState" | "replaceState"> {
  #state: MultiNamespaceAccountsState = {
    namespaces: {},
    active: null,
  };

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

describe("KeyringService", () => {
  it("hydrates namespace from vault envelope on attach", async () => {
    const envelope = createEnvelope(2);
    const vault = new FakeVault(textEncoder.encode(JSON.stringify(envelope)));
    const unlock = new FakeUnlock(true);
    const accounts = new MemoryAccountsController();

    const service = new KeyringService({
      vault,
      unlock,
      accounts,
      namespaces: {
        [EIP155_NAMESPACE]: { createKeyring: () => new EthereumHdKeyring() },
      },
    });

    service.attach();
    await flushAsync();

    expect(service.hasNamespace(EIP155_NAMESPACE)).toBe(true);
    expect(accounts.getState().namespaces[EIP155_NAMESPACE]?.all).toHaveLength(2);
  });

  it("derives next account and updates accounts state", async () => {
    const envelope = createEnvelope(1);
    const vault = new FakeVault(textEncoder.encode(JSON.stringify(envelope)));
    const unlock = new FakeUnlock(true);
    const accounts = new MemoryAccountsController();

    const service = new KeyringService({
      vault,
      unlock,
      accounts,
      namespaces: {
        [EIP155_NAMESPACE]: { createKeyring: () => new EthereumHdKeyring() },
      },
    });

    service.attach();
    await flushAsync();

    const derived = service.deriveNextAccount(EIP155_NAMESPACE);
    expect(derived.address).toMatch(/^0x[0-9a-f]{40}$/);
    expect(accounts.getState().namespaces[EIP155_NAMESPACE]?.all).toContain(derived.address);
  });

  it("sets namespace from mnemonic and exposes accounts when vault is locked", () => {
    const vault = new FakeVault(textEncoder.encode(""), false);
    const unlock = new FakeUnlock(false);
    const accounts = new MemoryAccountsController();

    const service = new KeyringService({
      vault,
      unlock,
      accounts,
      namespaces: {
        [EIP155_NAMESPACE]: { createKeyring: () => new EthereumHdKeyring() },
      },
    });

    const accountsAfterImport = service.setNamespaceFromMnemonic(EIP155_NAMESPACE, { mnemonic: MNEMONIC });
    expect(accountsAfterImport).not.toHaveLength(0);
    expect(service.hasNamespace(EIP155_NAMESPACE)).toBe(true);
    expect(accounts.getState().namespaces[EIP155_NAMESPACE]?.all).toHaveLength(accountsAfterImport.length);

    const storedEnvelope = service.getEnvelope();
    expect(storedEnvelope).not.toBeNull();
    const decoded = JSON.parse(textDecoder.decode(storedEnvelope!));
    expect(decoded.namespaces[EIP155_NAMESPACE]).toBeDefined();
  });

  it("removes namespace and clears accounts state", () => {
    const vault = new FakeVault(textEncoder.encode(""), false);
    const unlock = new FakeUnlock(false);
    const accounts = new MemoryAccountsController();

    const service = new KeyringService({
      vault,
      unlock,
      accounts,
      namespaces: {
        [EIP155_NAMESPACE]: { createKeyring: () => new EthereumHdKeyring() },
      },
    });

    service.setNamespaceFromMnemonic(EIP155_NAMESPACE, { mnemonic: MNEMONIC });
    expect(service.hasNamespace(EIP155_NAMESPACE)).toBe(true);

    service.removeNamespace(EIP155_NAMESPACE);
    expect(service.hasNamespace(EIP155_NAMESPACE)).toBe(false);
    expect(accounts.getState().namespaces[EIP155_NAMESPACE]).toBeUndefined();
  });

  it("emits envelope updates when deriving and removing accounts", async () => {
    const envelope = createEnvelope(1);
    const vault = new FakeVault(textEncoder.encode(JSON.stringify(envelope)));
    const unlock = new FakeUnlock(true);
    const accounts = new MemoryAccountsController();

    const service = new KeyringService({
      vault,
      unlock,
      accounts,
      namespaces: {
        [EIP155_NAMESPACE]: { createKeyring: () => new EthereumHdKeyring() },
      },
    });

    service.attach();
    await flushAsync();

    const events: Array<Uint8Array | null> = [];
    const unsubscribe = service.onEnvelopeUpdated((payload) => {
      events.push(payload ? new Uint8Array(payload) : null);
    });

    const derived = service.deriveNextAccount(EIP155_NAMESPACE);
    expect(events.length).toBeGreaterThan(0);

    const namespaceAfterDerive = accounts.getState().namespaces[EIP155_NAMESPACE];
    expect(namespaceAfterDerive?.all).toContain(derived.address);

    const previousLength = namespaceAfterDerive?.all.length ?? 0;
    service.removeAccount(EIP155_NAMESPACE, derived.address);

    const namespaceAfterRemove = accounts.getState().namespaces[EIP155_NAMESPACE];
    expect(namespaceAfterRemove?.all).not.toContain(derived.address);
    expect(namespaceAfterRemove?.all.length).toBe(previousLength - 1);
    expect(events.length).toBeGreaterThan(1);

    unsubscribe();
  });

  it("imports raw private key accounts and syncs namespace state", async () => {
    const envelope = createEnvelope(0);
    const vault = new FakeVault(textEncoder.encode(JSON.stringify(envelope)));
    const unlock = new FakeUnlock(true);
    const accounts = new MemoryAccountsController();

    const service = new KeyringService({
      vault,
      unlock,
      accounts,
      namespaces: {
        [EIP155_NAMESPACE]: { createKeyring: () => new EthereumHdKeyring() },
      },
    });

    service.attach();
    await flushAsync();

    const imported = service.importAccount(EIP155_NAMESPACE, PRIVATE_KEY);
    expect(imported.source).toBe("imported");

    const namespaceState = accounts.getState().namespaces[EIP155_NAMESPACE];
    expect(namespaceState?.all).toContain(imported.address);

    const recorded = service.getAccounts(EIP155_NAMESPACE).map((account) => account.address);
    expect(recorded).toContain(imported.address);
  });
});
