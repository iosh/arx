import type {
  BackgroundSessionServices,
  HandlerControllers,
  UnlockLockedPayload,
  UnlockReason,
  UnlockUnlockedPayload,
} from "@arx/core";
import { ApprovalTypes, ArxReasons, arxError, KeyringService } from "@arx/core";
import { EthereumHdKeyring, PrivateKeyKeyring } from "@arx/core/keyring";
import {
  UI_CHANNEL,
  UI_EVENT_SNAPSHOT_CHANGED,
  type UiMethodName,
  type UiMethodParams,
  type UiPortEnvelope,
  type UiSnapshot,
} from "@arx/core/ui";
import { beforeEach, describe, expect, it, vi } from "vitest";
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

  setPayload(next: Uint8Array | null) {
    this.#payload = next ? new Uint8Array(next) : new Uint8Array();
  }

  isUnlocked() {
    return this.#unlocked;
  }

  setUnlocked(next: boolean) {
    this.#unlocked = next;
  }

  async verifyPassword(password: string) {
    if (password !== this.#password) {
      throw arxError({
        reason: ArxReasons.VaultInvalidPassword,
        message: "Vault password is missing or incorrect",
      });
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

const createMemoryKeyringMetasStore = () => {
  let records: any[] = [];
  return {
    async get(id: string) {
      return records.find((r) => r.id === id) ?? null;
    },
    async list() {
      return [...records];
    },
    async upsert(record: any) {
      const next = { ...record };
      records = [...records.filter((r) => r.id !== next.id), next];
    },
    async remove(id: string) {
      records = records.filter((r) => r.id !== id);
    },
  };
};

const createMemoryAccountsStore = () => {
  let records: any[] = [];
  return {
    async get(accountId: string) {
      return records.find((r) => r.accountId === accountId) ?? null;
    },
    async list(_params?: { includeHidden?: boolean }) {
      return [...records];
    },
    async upsert(record: any) {
      const next = { ...record };
      records = [...records.filter((r) => r.accountId !== next.accountId), next];
    },
    async remove(accountId: string) {
      records = records.filter((r) => r.accountId !== accountId);
    },
    async removeByKeyringId(keyringId: string) {
      records = records.filter((r) => r.keyringId !== keyringId);
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

const createApprovalsController = () => {
  type StubTask = {
    id: string;
    type: string;
    origin: string;
    namespace?: string;
    chainRef?: string;
    payload: unknown;
    createdAt: number;
  };

  let tasks: StubTask[] = [];
  const listeners = new Set<(state: unknown) => void>();

  const getState = () => ({
    pending: tasks.map((task) => ({
      id: task.id,
      type: task.type,
      origin: task.origin,
      namespace: task.namespace,
      chainRef: task.chainRef,
      createdAt: task.createdAt,
    })),
  });

  const emit = () => {
    const state = getState();
    for (const fn of listeners) fn(state);
  };

  return {
    getState,
    get: (id: string) => tasks.find((task) => task.id === id),
    onStateChanged: (fn: (state: unknown) => void) => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    setPendingTasks: (next: StubTask[]) => {
      tasks = next.map((task) => ({ ...task }));
      emit();
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
    getState: () => ({ origins: {} }),
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

type MockBrowserApi = {
  runtime: { getURL: (p: string) => string };
  tabs: {
    query: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
    create: ReturnType<typeof vi.fn>;
  };
  windows: {
    update: ReturnType<typeof vi.fn>;
  };
};

const makeBrowser = (): MockBrowserApi => {
  return {
    runtime: { getURL: (p: string) => `ext://${p}` },
    tabs: {
      query: vi.fn(async () => []),
      update: vi.fn(async () => ({})),
      create: vi.fn(async () => ({ id: 1, windowId: 1 })),
    },
    windows: { update: vi.fn(async () => ({})) },
  };
};

const buildBridge = (opts?: { unlocked?: boolean; hasCiphertext?: boolean }) => {
  const vault = new FakeVault(new Uint8Array(), opts?.unlocked ?? true);
  const unlock = new FakeUnlock(opts?.unlocked ?? true);
  const keyringMetas = createMemoryKeyringMetasStore();
  const accountsStore = createMemoryAccountsStore();
  const accountsController = createAccountsController();
  let hasCiphertext = opts?.hasCiphertext ?? true;

  const keyring = new KeyringService({
    vault: {
      exportKey: () => vault.exportKey(),
      isUnlocked: () => vault.isUnlocked(),
      verifyPassword: (pwd: string) => vault.verifyPassword(pwd),
    },
    unlock,
    accountsStore,
    keyringMetas,
    namespaces: [
      {
        namespace: CHAIN.namespace,
        toCanonicalAddress: (addr: string) => addr.toLowerCase(),
        factories: {
          hd: () => new EthereumHdKeyring(),
          "private-key": () => new PrivateKeyKeyring(),
        },
      },
    ],
  });
  keyring.onPayloadUpdated((payload) => {
    vault.setPayload(payload);
  });
  keyring.attach();

  const approvalsController = createApprovalsController();
  const controllers = createControllers();
  (controllers as any).accounts = accountsController;
  (controllers as any).approvals = approvalsController;

  const session = {
    unlock,
    withVaultMetaPersistHold: async <T>(fn: () => Promise<T>) => await fn(),
    vault: {
      getStatus: () => ({ isUnlocked: vault.isUnlocked(), hasCiphertext }),
      initialize: async (_params: { password: string }) => {
        hasCiphertext = true;
        return {
          version: 1,
          algorithm: "pbkdf2-sha256",
          salt: "salt",
          iterations: 1,
          iv: "iv",
          cipher: "cipher",
          createdAt: Date.now(),
        };
      },
      verifyPassword: (pwd: string) => vault.verifyPassword(pwd),
    },
  } as unknown as BackgroundSessionServices;

  const browserApi = makeBrowser();
  const persistVaultMeta = vi.fn(async () => {});
  const bridge = createUiBridge({
    browser: browserApi as any,
    controllers,
    session,
    persistVaultMeta,
    keyring,
    attention: { getSnapshot: () => ({ queue: [], count: 0 }) },
  });

  return { bridge, keyring, vault, unlock, approvals: approvalsController, browser: browserApi, persistVaultMeta };
};

const createPort = () => new FakePort();

const expectError = (msg: any, reason: string) => {
  expect(msg?.type).toBe("ui:error");
  expect(msg?.error?.reason).toBe(reason);
};

const expectResponse = (msg: any, id: string) => {
  expect(msg?.type).toBe("ui:response");
  expect(msg?.id).toBe(id);
  return msg?.result;
};

const latestSnapshotFromMessages = (messages: unknown[]) => {
  const events = messages.filter((m: any) => m?.type === "ui:event" && m?.event === UI_EVENT_SNAPSHOT_CHANGED) as any[];
  const last = events[events.length - 1];
  expect(last).toBeTruthy();
  return last.payload as UiSnapshot;
};

describe("uiBridge", () => {
  let bridge: ReturnType<typeof buildBridge>["bridge"];
  let keyring: ReturnType<typeof buildBridge>["keyring"];
  let vault: FakeVault;
  let unlock: FakeUnlock;
  let approvals: ReturnType<typeof buildBridge>["approvals"];
  let port: FakePort;
  let runtimeBrowser: ReturnType<typeof makeBrowser>;

  beforeEach(() => {
    const ctx = buildBridge({ unlocked: true });
    bridge = ctx.bridge;
    keyring = ctx.keyring;
    vault = ctx.vault;
    unlock = ctx.unlock;
    approvals = ctx.approvals;
    runtimeBrowser = ctx.browser;

    port = createPort();
    bridge.attachPort(port as any);
    bridge.attachListeners();
    port.messages = []; // drop initial snapshot
  });

  const send = async <M extends UiMethodName>(method: M, params?: UiMethodParams<M>) => {
    const id = crypto.randomUUID();
    const envelope: UiPortEnvelope = { type: "ui:request", id, method, params };
    await port.triggerMessage(envelope);
    const message = port.messages.find(
      (m: any) => m?.id === id && (m?.type === "ui:response" || m?.type === "ui:error"),
    );
    return { envelope: message as any, id };
  };

  it("rejects when locked", async () => {
    unlock.setUnlocked(false);
    vault.setUnlocked(false);

    const { envelope } = await send("ui.keyrings.confirmNewMnemonic", {
      words: Array.from({ length: 12 }, () => "word"),
      alias: "test",
    } as any);

    expectError(envelope, ArxReasons.SessionLocked);
  });

  it("onboarding.generateMnemonic works when locked", async () => {
    unlock.setUnlocked(false);
    vault.setUnlocked(false);

    const { envelope, id } = await send("ui.onboarding.generateMnemonic", { wordCount: 12 });
    const res = expectResponse(envelope, id);
    expect(res.words).toHaveLength(12);
  });

  it("onboarding.createWalletFromMnemonic supports setupIncomplete and holds snapshot broadcast", async () => {
    // Default test setup starts with a vault that has ciphertext but no accounts.
    const id = crypto.randomUUID();
    const words = TEST_MNEMONIC.split(" ");

    await port.triggerMessage({
      type: "ui:request",
      id,
      method: "ui.onboarding.createWalletFromMnemonic",
      params: { words, skipBackup: true },
    } satisfies UiPortEnvelope);

    const responseIndex = port.messages.findIndex((m: any) => m?.type === "ui:response" && m?.id === id);
    expect(responseIndex).toBeGreaterThanOrEqual(0);

    const snapshotEvents = port.messages
      .map((m: any, idx: number) => ({ m, idx }))
      .filter(({ m }) => m?.type === "ui:event" && m?.event === UI_EVENT_SNAPSHOT_CHANGED);
    const lastSnapshotEventIndex = snapshotEvents.at(-1)?.idx ?? -1;
    expect(lastSnapshotEventIndex).toBeGreaterThan(responseIndex);

    const snapshot = latestSnapshotFromMessages(port.messages);
    expect(snapshot.vault.initialized).toBe(true);
    expect(snapshot.accounts.totalCount).toBeGreaterThan(0);
  });

  it("maps invalid mnemonic to keyring/invalid_mnemonic", async () => {
    const words = Array.from({ length: 12 }, () => "foo");
    const { envelope } = await send("ui.keyrings.confirmNewMnemonic", { words, alias: "bad" } as any);
    expectError(envelope, ArxReasons.KeyringInvalidMnemonic);
  });

  it("maps duplicate mnemonic to keyring/duplicate_account", async () => {
    const words = TEST_MNEMONIC.split(" ");
    const first = await send("ui.keyrings.confirmNewMnemonic", { words, alias: "first" });
    expectResponse(first.envelope, first.id);

    const second = await send("ui.keyrings.confirmNewMnemonic", { words, alias: "dup" });
    expectError(second.envelope, ArxReasons.KeyringDuplicateAccount);
  });

  it("happy path: derive, hide/unhide, export", async () => {
    const words = TEST_MNEMONIC.split(" ");
    const createRes = await send("ui.keyrings.confirmNewMnemonic", { words, alias: "main" });
    const createResult = expectResponse(createRes.envelope, createRes.id) as { keyringId: string; address: string };
    const { keyringId, address } = createResult;
    expect(keyringId).toBeTruthy();
    expect(address).toMatch(/^0x/);

    const deriveRes = await send("ui.keyrings.deriveAccount", { keyringId });
    const derived = expectResponse(deriveRes.envelope, deriveRes.id) as {
      address: string;
      derivationIndex?: number | null;
    };
    expect(derived.address).toMatch(/^0x/);
    expect(derived.derivationIndex).toBe(1);

    const derivedAccountId = `eip155:${derived.address.slice(2).toLowerCase()}`;

    const hideRes = await send("ui.keyrings.hideHdAccount", { accountId: derivedAccountId });
    expectResponse(hideRes.envelope, hideRes.id);

    const unhideRes = await send("ui.keyrings.unhideHdAccount", { accountId: derivedAccountId });
    expectResponse(unhideRes.envelope, unhideRes.id);

    const exportMnemonic = await send("ui.keyrings.exportMnemonic", { keyringId, password: PASSWORD });
    const exported = expectResponse(exportMnemonic.envelope, exportMnemonic.id) as { words: string[] };
    expect(exported.words.join(" ")).toBe(TEST_MNEMONIC);

    const exportPk = await send("ui.keyrings.exportPrivateKey", { address, password: PASSWORD });
    const pkResult = expectResponse(exportPk.envelope, exportPk.id) as { privateKey: string };
    expect(pkResult.privateKey.length).toBe(64);
  });

  it("requires valid password before exporting mnemonic", async () => {
    const words = TEST_MNEMONIC.split(" ");
    const createRes = await send("ui.keyrings.confirmNewMnemonic", { words, alias: "main" });
    const { keyringId } = expectResponse(createRes.envelope, createRes.id) as { keyringId: string };

    const spy = vi.spyOn(keyring, "exportMnemonic");
    const exportAttempt = await send("ui.keyrings.exportMnemonic", { keyringId, password: "wrong-password" });
    expectError(exportAttempt.envelope, ArxReasons.VaultInvalidPassword);
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it("zeroizes private key buffers after export", async () => {
    const words = TEST_MNEMONIC.split(" ");
    const createRes = await send("ui.keyrings.confirmNewMnemonic", { words, alias: "main" });
    const createResult = expectResponse(createRes.envelope, createRes.id) as { keyringId: string; address: string };

    const secret = new Uint8Array([0xde, 0xad, 0xbe, 0xef, ...new Uint8Array(28)]);
    const spy = vi.spyOn(keyring, "exportPrivateKeyByAddress").mockResolvedValue(secret);

    const exportPk = await send("ui.keyrings.exportPrivateKey", { address: createResult.address, password: PASSWORD });
    const pkResult = expectResponse(exportPk.envelope, exportPk.id) as { privateKey: string };

    expect(pkResult.privateKey).toBe(`deadbeef${"00".repeat(28)}`);
    expect(Array.from(secret).every((byte) => byte === 0)).toBe(true);
    spy.mockRestore();
  });

  it("emits snapshotChanged when approvals queue changes", async () => {
    const id = crypto.randomUUID();
    approvals.setPendingTasks([
      {
        id,
        type: ApprovalTypes.RequestAccounts,
        origin: "https://example.com",
        namespace: CHAIN.namespace,
        chainRef: CHAIN.chainRef,
        payload: { suggestedAccounts: [] },
        createdAt: Date.now(),
      },
    ]);

    const snapshot = latestSnapshotFromMessages(port.messages);
    expect(snapshot.approvals).toHaveLength(1);
    expect(snapshot.approvals[0].id).toBe(id);
    expect(snapshot.approvals[0].type).toBe("requestAccounts");
  });

  it("session.unlock triggers snapshotChanged with unlocked state", async () => {
    unlock.setUnlocked(false);
    vault.setUnlocked(false);
    port.messages = [];

    const res = await send("ui.session.unlock", { password: PASSWORD });
    expectResponse(res.envelope, res.id);

    const snapshot = latestSnapshotFromMessages(port.messages);
    expect(snapshot.session.isUnlocked).toBe(true);
  });

  it("onboarding.openTab: creates then debounces within cooldown", async () => {
    let t = 0;
    const nowSpy = vi.spyOn(Date, "now").mockImplementation(() => t);

    runtimeBrowser.tabs.query.mockResolvedValueOnce([]);
    runtimeBrowser.tabs.create.mockResolvedValueOnce({ id: 1, windowId: 2 });

    const first = await send("ui.onboarding.openTab", { reason: "manual_open" });
    expect(expectResponse(first.envelope, first.id)).toMatchObject({ activationPath: "create", tabId: 1 });
    expect(runtimeBrowser.tabs.create).toHaveBeenCalledWith({ url: "ext://onboarding.html", active: true });

    t = 100;
    const second = await send("ui.onboarding.openTab", { reason: "manual_open" });
    expect(expectResponse(second.envelope, second.id)).toMatchObject({ activationPath: "debounced", tabId: 1 });
    expect(runtimeBrowser.tabs.create).toHaveBeenCalledTimes(1);

    nowSpy.mockRestore();
  });

  it("onboarding.openTab: focuses existing tab via query fallback", async () => {
    const nowSpy = vi.spyOn(Date, "now").mockReturnValue(0);

    runtimeBrowser.tabs.query.mockImplementation(async (queryInfo: any) => {
      if (queryInfo?.url) throw new Error("query-by-url failed");
      return [{ id: 7, windowId: 8, url: "ext://onboarding.html" }];
    });

    const res = await send("ui.onboarding.openTab", { reason: "manual_open" });

    expect(expectResponse(res.envelope, res.id)).toMatchObject({ activationPath: "focus", tabId: 7 });
    expect(runtimeBrowser.tabs.update).toHaveBeenCalledWith(7, { active: true });
    expect(runtimeBrowser.windows.update).toHaveBeenCalledWith(8, { focused: true });
    expect(runtimeBrowser.tabs.create).not.toHaveBeenCalled();

    nowSpy.mockRestore();
  });
});
