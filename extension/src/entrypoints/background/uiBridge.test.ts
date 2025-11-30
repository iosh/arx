import type {
  BackgroundSessionServices,
  HandlerControllers,
  UnlockLockedPayload,
  UnlockReason,
  UnlockUnlockedPayload,
} from "@arx/core";
import { KeyringService } from "@arx/core";
import { keyringErrors, vaultErrors } from "@arx/core/errors";
import { EthereumHdKeyring, PrivateKeyKeyring } from "@arx/core/keyring";
import { UI_CHANNEL, type UiMessage } from "@arx/core/ui";
import { beforeEach, describe, expect, it } from "vitest";
import { createUiBridge } from "./uiBridge";

const TEST_MNEMONIC = "test test test test test test test test test test test junk";
const PASSWORD = "secret";
const CHAIN = {
  chainRef: "eip155:1",
  chainId: "0x1",
  namespace: "eip155",
  displayName: "Ethereum",
  shortName: "eth",
  icon: null,
};

type Listener = (msg: unknown) => void;

class FakePort {
  name = UI_CHANNEL;
  messages: unknown[] = [];
  #messageListeners = new Set<Listener>();
  #disconnectListeners = new Set<() => void>();

  postMessage = (msg: unknown) => {
    this.messages.push(msg);
  };

  onMessage = {
    addListener: (fn: Listener) => this.#messageListeners.add(fn),
    removeListener: (fn: Listener) => this.#messageListeners.delete(fn),
  };

  onDisconnect = {
    addListener: (fn: () => void) => this.#disconnectListeners.add(fn),
    removeListener: (fn: () => void) => this.#disconnectListeners.delete(fn),
  };

  async triggerMessage(msg: unknown) {
    for (const fn of this.#messageListeners) {
      await fn(msg);
    }
  }

  disconnect() {
    for (const fn of this.#disconnectListeners) {
      fn();
    }
  }
}

class FakeVault {
  #payload: Uint8Array;
  #unlocked: boolean;
  #password: string;

  constructor(payload: Uint8Array = new Uint8Array(), unlocked = true, password = PASSWORD) {
    this.#payload = payload;
    this.#unlocked = unlocked;
    this.#password = password;
  }

  exportKey() {
    return new Uint8Array(this.#payload);
  }

  isUnlocked() {
    return this.#unlocked;
  }

  setUnlocked(next: boolean) {
    this.#unlocked = next;
  }

  async verifyPassword(password: string) {
    if (password !== this.#password) {
      throw vaultErrors.invalidPassword();
    }
  }
}

type UnlockState = {
  isUnlocked: boolean;
  timeoutMs: number;
  nextAutoLockAt: number | null;
  lastUnlockedAt: number | null;
};

class FakeUnlock {
  #state: UnlockState;
  #unlockedHandlers = new Set<(payload: UnlockUnlockedPayload) => void>();
  #lockedHandlers = new Set<(payload: UnlockLockedPayload) => void>();
  #stateHandlers = new Set<(state: UnlockState) => void>();

  constructor(unlocked = true, timeoutMs = 900_000) {
    this.#state = {
      isUnlocked: unlocked,
      timeoutMs,
      nextAutoLockAt: null,
      lastUnlockedAt: unlocked ? Date.now() : null,
    };
  }

  isUnlocked() {
    return this.#state.isUnlocked;
  }

  getState() {
    return { ...this.#state };
  }

  async unlock(_params: { password: string }) {
    this.#state = { ...this.#state, isUnlocked: true, lastUnlockedAt: Date.now(), nextAutoLockAt: null };
    for (const fn of this.#unlockedHandlers) fn({ at: Date.now() });
    for (const fn of this.#stateHandlers) fn(this.getState());
  }

  lock(reason: UnlockReason) {
    this.#state = { ...this.#state, isUnlocked: false, nextAutoLockAt: null };
    for (const fn of this.#lockedHandlers) fn({ at: Date.now(), reason });
    for (const fn of this.#stateHandlers) fn(this.getState());
  }

  scheduleAutoLock(_ms?: number) {
    // no-op for tests
  }

  onUnlocked(fn: (payload: UnlockUnlockedPayload) => void) {
    this.#unlockedHandlers.add(fn);
    return () => this.#unlockedHandlers.delete(fn);
  }

  onLocked(fn: (payload: UnlockLockedPayload) => void) {
    this.#lockedHandlers.add(fn);
    return () => this.#lockedHandlers.delete(fn);
  }

  onStateChanged(fn: (state: UnlockState) => void) {
    this.#stateHandlers.add(fn);
    return () => this.#stateHandlers.delete(fn);
  }

  setUnlocked(next: boolean) {
    if (next) {
      void this.unlock({ password: PASSWORD });
    } else {
      this.lock("manual");
    }
  }
}

const createMemoryKeyringStore = () => {
  let keyrings: any[] = [];
  let accounts: any[] = [];
  return {
    async getKeyringMetas() {
      return [...keyrings];
    },
    async getAccountMetas() {
      return [...accounts];
    },
    async putKeyringMetas(metas: any[]) {
      keyrings = metas.map((m) => ({ ...m }));
    },
    async putAccountMetas(metas: any[]) {
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
  };
};

const createAccountsController = () => {
  let state = {
    namespaces: { [CHAIN.namespace]: { all: [] as string[], primary: null as string | null } },
    active: null as { namespace: string; chainRef: string; address: string | null } | null,
  };
  const listeners = new Set<(s: typeof state) => void>();

  const emit = () => {
    for (const fn of listeners) fn({ ...state, namespaces: { ...state.namespaces } });
  };

  return {
    getState: () => ({
      namespaces: structuredClone(state.namespaces),
      active: state.active ? { ...state.active } : null,
    }),
    replaceState: (next: typeof state) => {
      state = structuredClone(next);
      emit();
    },
    getAccounts: (_params?: { chainRef?: string }) => state.namespaces[CHAIN.namespace]?.all ?? [],
    getActivePointer: () => state.active,
    addAccount: async (params: { chainRef: string; address: string; makePrimary?: boolean }) => {
      const ns = CHAIN.namespace;
      const prev = state.namespaces[ns] ?? { all: [], primary: null };
      const all = prev.all.includes(params.address) ? prev.all : [...prev.all, params.address];
      const primary = params.makePrimary ? params.address : (prev.primary ?? params.address);
      state = {
        namespaces: { ...state.namespaces, [ns]: { all, primary } },
        active: state.active ?? { namespace: ns, chainRef: params.chainRef, address: primary },
      };
      emit();
      return state.namespaces[ns];
    },
    switchActive: async (params: { chainRef: string; address?: string | null }) => {
      state = {
        ...state,
        active: params.address
          ? { namespace: CHAIN.namespace, chainRef: params.chainRef, address: params.address }
          : null,
      };
      emit();
      return state.active;
    },
    removeAccount: async (params: { chainRef: string; address: string }) => {
      const ns = CHAIN.namespace;
      const prev = state.namespaces[ns] ?? { all: [], primary: null };
      const all = prev.all.filter((a) => a !== params.address);
      const primary = prev.primary === params.address ? (all[0] ?? null) : prev.primary;
      state = { namespaces: { ...state.namespaces, [ns]: { all, primary } }, active: state.active };
      emit();
      return state.namespaces[ns];
    },
    onStateChanged: (fn: (s: any) => void) => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
  };
};

const createControllers = () => {
  const accounts = createAccountsController();
  const approvals = {
    getState: () => ({ pending: [] as any[] }),
    get: (_id: string) => null,
    onStateChanged: (fn: () => void) => {
      return () => void fn;
    },
  };
  const permissions = {
    getState: () => ({}),
  };
  const networkListeners = new Set<() => void>();
  const network = {
    getActiveChain: () => CHAIN,
    getState: () => ({ activeChain: CHAIN.chainRef, knownChains: [CHAIN] }),
    switchChain: async (_chainRef: string) => {},
    onStateChanged: (fn: () => void) => {
      networkListeners.add(fn);
      return () => networkListeners.delete(fn);
    },
    onChainChanged: (fn: (c: typeof CHAIN) => void) => {
      return () => void fn;
    },
    getChain: (_chainRef: string) => CHAIN,
  };
  const transactions = {
    approveTransaction: async () => null,
    processTransaction: async () => {},
    onStateChanged: () => () => {},
  };
  const chainRegistry = { onStateChanged: () => () => {}, getChain: () => CHAIN };
  const signers = { eip155: { signPersonalMessage: async () => "", signTypedData: async () => "" } };

  return {
    accounts,
    approvals,
    permissions,
    network,
    transactions,
    chainRegistry,
    signers,
  } as unknown as HandlerControllers;
};

const buildBridge = (opts?: { unlocked?: boolean }) => {
  const vault = new FakeVault(new Uint8Array(), opts?.unlocked ?? true);
  const unlock = new FakeUnlock(opts?.unlocked ?? true);
  const keyringStore = createMemoryKeyringStore();
  const accountsController = createAccountsController();

  const keyring = new KeyringService({
    vault: {
      exportKey: () => vault.exportKey(),
      isUnlocked: () => vault.isUnlocked(),
      verifyPassword: (pwd) => vault.verifyPassword(pwd),
    },
    unlock,
    accounts: {
      getState: () => accountsController.getState(),
      replaceState: (next) => accountsController.replaceState(next),
    },
    keyringStore,
    namespaces: [
      {
        namespace: CHAIN.namespace,
        normalizeAddress: (addr: string) => addr.toLowerCase(),
        factories: {
          hd: () => new EthereumHdKeyring(),
          "private-key": () => new PrivateKeyKeyring(),
        },
      },
    ],
  });
  keyring.attach();

  const controllers = createControllers();
  (controllers as any).accounts = accountsController;

  const session = {
    unlock,
    vault: { getStatus: () => ({ isUnlocked: vault.isUnlocked(), hasCiphertext: true }) },
  } as unknown as BackgroundSessionServices;

  const bridge = createUiBridge({
    controllers,
    session,
    persistVaultMeta: async () => {},
    keyring,
  });

  return { bridge, keyring, vault, unlock };
};

const createPort = () => new FakePort();

const expectError = (msg: any, code: number, reason?: string) => {
  expect(msg?.type).toBe("ui:error");
  expect(msg?.error?.code).toBe(code);
  if (reason) {
    expect(msg?.error?.data?.reason).toBe(reason);
  }
};

const expectResponse = (msg: any, requestId: string) => {
  expect(msg?.type).toBe("ui:response");
  expect(msg?.requestId).toBe(requestId);
  return msg?.result;
};

describe("uiBridge", () => {
  let bridge: ReturnType<typeof buildBridge>["bridge"];
  let vault: FakeVault;
  let unlock: FakeUnlock;
  let port: FakePort;

  beforeEach(() => {
    const ctx = buildBridge({ unlocked: true });
    bridge = ctx.bridge;
    vault = ctx.vault;
    unlock = ctx.unlock;
    port = createPort();
    bridge.attachPort(port as any);
    port.messages = []; // drop initial snapshot
  });

  const send = async (payload: UiMessage) => {
    const requestId = crypto.randomUUID();
    await port.triggerMessage({ type: "ui:request", requestId, payload });
    const message = port.messages.find((m: any) => m.requestId === requestId);
    return { envelope: message as any, requestId };
  };

  it("rejects when locked", async () => {
    unlock.setUnlocked(false);
    vault.setUnlocked(false);

    const { envelope } = await send({ type: "ui:generateMnemonic", payload: { wordCount: 12 } } as UiMessage);
    expectError(envelope, 4100);
  });

  it("maps invalid mnemonic to 32602", async () => {
    const { envelope } = await send({
      type: "ui:confirmNewMnemonic",
      payload: { words: ["foo", "bar"], alias: "bad" },
    } as UiMessage);
    expectError(envelope, 32602);
  });

  it("maps duplicate mnemonic to 4001/resourceExists", async () => {
    const words = TEST_MNEMONIC.split(" ");
    const first = await send({
      type: "ui:confirmNewMnemonic",
      payload: { words, alias: "first" },
    } as UiMessage);
    expectResponse(first.envelope, first.requestId);

    const second = await send({
      type: "ui:confirmNewMnemonic",
      payload: { words, alias: "dup" },
    } as UiMessage);
    expectError(second.envelope, 4001, "resourceExists");
  });

  it("happy path: derive, hide/unhide, export", async () => {
    const words = TEST_MNEMONIC.split(" ");
    const createRes = await send({
      type: "ui:confirmNewMnemonic",
      payload: { words, alias: "main" },
    } as UiMessage);
    const createResult = expectResponse(createRes.envelope, createRes.requestId) as {
      keyringId: string;
      address: string;
    };
    const { keyringId, address } = createResult;
    expect(keyringId).toBeTruthy();
    expect(address).toMatch(/^0x/);

    const deriveRes = await send({ type: "ui:deriveAccount", payload: { keyringId } } as UiMessage);
    const derived = expectResponse(deriveRes.envelope, deriveRes.requestId) as {
      address: string;
      derivationIndex?: number;
    };
    expect(derived.address).toMatch(/^0x/);
    expect(derived.derivationIndex).toBe(1);

    const hideRes = await send({ type: "ui:hideHdAccount", payload: { address: derived.address } } as UiMessage);
    expectResponse(hideRes.envelope, hideRes.requestId);

    const unhideRes = await send({ type: "ui:unhideHdAccount", payload: { address: derived.address } } as UiMessage);
    expectResponse(unhideRes.envelope, unhideRes.requestId);

    const exportMnemonic = await send({
      type: "ui:exportMnemonic",
      payload: { keyringId, password: PASSWORD },
    } as UiMessage);
    const exported = expectResponse(exportMnemonic.envelope, exportMnemonic.requestId) as { words: string[] };
    expect(exported.words.join(" ")).toBe(TEST_MNEMONIC);

    const exportPk = await send({
      type: "ui:exportPrivateKey",
      payload: { address, password: PASSWORD },
    } as UiMessage);
    const pkResult = expectResponse(exportPk.envelope, exportPk.requestId) as { privateKey: string };
    expect(pkResult.privateKey.length).toBe(64);
  });
});
