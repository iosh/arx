import type {
  BackgroundSessionServices,
  HandlerControllers,
  UnlockLockedPayload,
  UnlockReason,
  UnlockUnlockedPayload,
} from "@arx/core";
import {
  ApprovalTypes,
  ArxReasons,
  arxError,
  createRpcRegistry,
  KeyringService,
  registerBuiltinRpcAdapters,
} from "@arx/core";
import { getAccountCodec, toAccountIdFromAddress, toCanonicalAddressFromAccountId } from "@arx/core/accounts";
import { EvmHdKeyring, EvmPrivateKeyKeyring } from "@arx/core/keyring";
import type { AccountId, AccountRecord, KeyringMetaRecord } from "@arx/core/storage";
import {
  UI_CHANNEL,
  UI_EVENT_SNAPSHOT_CHANGED,
  type UiMethodName,
  type UiMethodParams,
  type UiPortEnvelope,
  type UiSnapshot,
} from "@arx/core/ui";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { UiPort } from "./ui/portHub";
import { createUiBridge } from "./uiBridge";

const rpcRegistry = createRpcRegistry();
registerBuiltinRpcAdapters(rpcRegistry);

const TEST_MNEMONIC = "test test test test test test test test test test test junk";
const PASSWORD = "secret";
const CHAIN = {
  chainRef: "eip155:1",
  chainId: "0x1",
  namespace: "eip155",
  displayName: "Ethereum",
  shortName: "eth",
  icon: null,
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
};

type ChainRef = Parameters<typeof toAccountIdFromAddress>[0]["chainRef"];

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
  let records: KeyringMetaRecord[] = [];
  return {
    async get(id: string) {
      return records.find((r) => r.id === id) ?? null;
    },
    async list() {
      return [...records];
    },
    async upsert(record: KeyringMetaRecord) {
      const next = { ...record };
      records = [...records.filter((r) => r.id !== next.id), next];
    },
    async remove(id: string) {
      records = records.filter((r) => r.id !== id);
    },
  };
};

const createMemoryAccountsStore = () => {
  let records: AccountRecord[] = [];
  return {
    async get(accountId: AccountId) {
      return records.find((r) => r.accountId === accountId) ?? null;
    },
    async list(_params?: { includeHidden?: boolean }) {
      void _params;
      return [...records];
    },
    async upsert(record: AccountRecord) {
      const next = { ...record };
      records = [...records.filter((r) => r.accountId !== next.accountId), next];
    },
    async remove(accountId: AccountId) {
      records = records.filter((r) => r.accountId !== accountId);
    },
    async removeByKeyringId(keyringId: string) {
      records = records.filter((r) => r.keyringId !== keyringId);
    },
  };
};

const createStoreBackedAccountsController = (deps: { accountsStore: ReturnType<typeof createMemoryAccountsStore> }) => {
  const toAccountId = (chainRef: ChainRef, address: string) => toAccountIdFromAddress({ chainRef, address });
  const toAddress = (chainRef: ChainRef, accountId: AccountId) =>
    toCanonicalAddressFromAccountId({ chainRef, accountId });

  let state = {
    namespaces: { [CHAIN.namespace]: { accountIds: [] as AccountId[], selectedAccountId: null as AccountId | null } },
  };
  const listeners = new Set<(s: typeof state) => void>();

  const emit = () => {
    for (const fn of listeners) fn({ ...state, namespaces: { ...state.namespaces } });
  };

  const refresh = async () => {
    const rows = await deps.accountsStore.list({ includeHidden: true });
    const all = rows
      .filter((r) => r.namespace === CHAIN.namespace)
      .map((r) => `0x${String(r.payloadHex ?? "").toLowerCase()}`)
      .filter((a: string) => /^0x[0-9a-f]{40}$/.test(a));

    const uniq = Array.from(new Set(all));
    const accountIds = uniq.map((addr) => toAccountId(CHAIN.chainRef, addr));
    const currentSelected = state.namespaces[CHAIN.namespace]?.selectedAccountId ?? null;
    const selectedAccountId =
      currentSelected && accountIds.includes(currentSelected) ? currentSelected : (accountIds[0] ?? null);
    state = { namespaces: { [CHAIN.namespace]: { accountIds, selectedAccountId } } };

    emit();
  };

  // Wrap store writers so controller state stays in sync for unit tests.
  const wrap = <Args extends unknown[], R>(fn: (...args: Args) => Promise<R>) => {
    return async (...args: Args): Promise<R> => {
      const res = await fn(...args);
      await refresh();
      return res;
    };
  };
  deps.accountsStore.upsert = wrap(deps.accountsStore.upsert);
  deps.accountsStore.remove = wrap(deps.accountsStore.remove);
  deps.accountsStore.removeByKeyringId = wrap(deps.accountsStore.removeByKeyringId);

  // Initial refresh so snapshot sees stored state.
  void refresh();

  return {
    refresh,
    getState: () => ({
      namespaces: structuredClone(state.namespaces),
    }),
    getAccounts: (params: { chainRef: string }) =>
      (state.namespaces[CHAIN.namespace]?.accountIds ?? []).map((id) => toAddress(params.chainRef, id)).filter(Boolean),
    getAccountIdsForNamespace: (_namespace: string) => state.namespaces[CHAIN.namespace]?.accountIds ?? [],
    getSelectedAccountId: (_namespace: string) => state.namespaces[CHAIN.namespace]?.selectedAccountId ?? null,
    getSelectedPointer: (params: { chainRef: string }) => {
      const selected = state.namespaces[CHAIN.namespace]?.selectedAccountId ?? null;
      if (!selected) return null;
      return {
        namespace: CHAIN.namespace,
        chainRef: params.chainRef,
        accountId: selected,
        address: toAddress(params.chainRef, selected),
      };
    },
    getSelectedAddress: (_params: { chainRef: string }) => {
      void _params;
      const selected = state.namespaces[CHAIN.namespace]?.selectedAccountId ?? null;
      return selected ? toAddress(_params.chainRef, selected) : null;
    },
    addAccount: async () => {
      throw new Error("addAccount is not supported in store-backed test controller");
    },
    switchActive: async (params: { chainRef: string; address?: string | null }) => {
      const desired = params.address ? toAccountId(params.chainRef, params.address) : null;
      const current = state.namespaces[CHAIN.namespace]?.accountIds ?? [];
      const selectedAccountId = desired && current.includes(desired) ? desired : (current[0] ?? null);
      state = { namespaces: { [CHAIN.namespace]: { accountIds: [...current], selectedAccountId } } };
      emit();
      return selectedAccountId
        ? {
            namespace: CHAIN.namespace,
            chainRef: params.chainRef,
            accountId: selectedAccountId,
            address: toAddress(params.chainRef, selectedAccountId),
          }
        : null;
    },
    removeAccount: async () => {
      throw new Error("removeAccount is not supported in store-backed test controller");
    },
    onStateChanged: (fn: (s: typeof state) => void) => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    onSelectedChanged: (fn: unknown) => {
      void fn;
      return () => {};
    },
    onNamespaceChanged: (fn: unknown) => {
      void fn;
      return () => {};
    },
  };
};

const createAccountsController = () => {
  const toAccountId = (chainRef: ChainRef, address: string) => toAccountIdFromAddress({ chainRef, address });
  const toAddress = (chainRef: ChainRef, accountId: AccountId) =>
    toCanonicalAddressFromAccountId({ chainRef, accountId });

  let state = {
    namespaces: { [CHAIN.namespace]: { accountIds: [] as AccountId[], selectedAccountId: null as AccountId | null } },
  };
  const listeners = new Set<(s: typeof state) => void>();

  const emit = () => {
    for (const fn of listeners) fn({ ...state, namespaces: { ...state.namespaces } });
  };

  return {
    getState: () => ({
      namespaces: structuredClone(state.namespaces),
    }),
    getAccounts: (params: { chainRef: string }) =>
      (state.namespaces[CHAIN.namespace]?.accountIds ?? []).map((id) => toAddress(params.chainRef, id)).filter(Boolean),
    getAccountIdsForNamespace: (_namespace: string) => state.namespaces[CHAIN.namespace]?.accountIds ?? [],
    getSelectedAccountId: (_namespace: string) => state.namespaces[CHAIN.namespace]?.selectedAccountId ?? null,
    getSelectedPointer: (params: { chainRef: string }) => {
      const selected = state.namespaces[CHAIN.namespace]?.selectedAccountId ?? null;
      if (!selected) return null;
      return {
        namespace: CHAIN.namespace,
        chainRef: params.chainRef,
        accountId: selected,
        address: toAddress(params.chainRef, selected),
      };
    },
    getSelectedAddress: (_params: { chainRef: string }) => {
      void _params;
      const selected = state.namespaces[CHAIN.namespace]?.selectedAccountId ?? null;
      return selected ? toAddress(_params.chainRef, selected) : null;
    },
    addAccount: async (params: { chainRef: string; address: string; makePrimary?: boolean }) => {
      const ns = CHAIN.namespace;
      const prev = state.namespaces[ns] ?? { accountIds: [], selectedAccountId: null };
      const id = toAccountId(params.chainRef, params.address);
      const accountIds = prev.accountIds.includes(id) ? prev.accountIds : [...prev.accountIds, id];
      const selectedAccountId = params.makePrimary ? id : (prev.selectedAccountId ?? accountIds[0] ?? null);
      state = { namespaces: { ...state.namespaces, [ns]: { accountIds, selectedAccountId } } };
      emit();
      return state.namespaces[ns];
    },
    switchActive: async (params: { chainRef: string; address?: string | null }) => {
      const ns = CHAIN.namespace;
      const prev = state.namespaces[ns] ?? { accountIds: [], selectedAccountId: null };
      const desired = params.address ? toAccountId(params.chainRef, params.address) : null;
      const selectedAccountId = desired && prev.accountIds.includes(desired) ? desired : (prev.accountIds[0] ?? null);
      state = { namespaces: { ...state.namespaces, [ns]: { ...prev, selectedAccountId } } };
      emit();
      return selectedAccountId
        ? {
            namespace: ns,
            chainRef: params.chainRef,
            accountId: selectedAccountId,
            address: toAddress(params.chainRef, selectedAccountId),
          }
        : null;
    },
    removeAccount: async (params: { chainRef: string; address: string }) => {
      const ns = CHAIN.namespace;
      const prev = state.namespaces[ns] ?? { accountIds: [], selectedAccountId: null };
      const id = toAccountId(params.chainRef, params.address);
      const accountIds = prev.accountIds.filter((a) => a !== id);
      const selectedAccountId =
        prev.selectedAccountId === id ? (accountIds[0] ?? null) : (prev.selectedAccountId ?? accountIds[0] ?? null);
      state = { namespaces: { ...state.namespaces, [ns]: { accountIds, selectedAccountId } } };
      emit();
      return state.namespaces[ns];
    },
    onStateChanged: (fn: (s: typeof state) => void) => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    onSelectedChanged: (fn: unknown) => {
      void fn;
      return () => {};
    },
    onNamespaceChanged: (fn: unknown) => {
      void fn;
      return () => {};
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
    getState: () => ({ pending: [] as unknown[] }),
    get: (_id: string) => {
      void _id;
      return null;
    },
    onStateChanged: (fn: () => void) => {
      return () => void fn;
    },
  };
  const permissionListeners = new Set<(state: unknown) => void>();
  const permissions = {
    getState: () => ({ origins: {} }),
    onPermissionsChanged: (fn: (state: unknown) => void) => {
      permissionListeners.add(fn);
      return () => permissionListeners.delete(fn);
    },
  };
  const networkListeners = new Set<() => void>();
  const network = {
    getActiveChain: () => CHAIN,
    getState: () => ({ activeChain: CHAIN.chainRef, knownChains: [CHAIN] }),
    switchChain: async (_chainRef: string) => {
      void _chainRef;
    },
    onStateChanged: (fn: () => void) => {
      networkListeners.add(fn);
      return () => networkListeners.delete(fn);
    },
    onChainChanged: (fn: (c: typeof CHAIN) => void) => {
      return () => void fn;
    },
    getChain: (_chainRef: string) => {
      void _chainRef;
      return CHAIN;
    },
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
  const accountsController = createStoreBackedAccountsController({ accountsStore });
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
        defaultChainRef: CHAIN.chainRef,
        codec: getAccountCodec(CHAIN.namespace),
        factories: {
          hd: () => new EvmHdKeyring(),
          "private-key": () => new EvmPrivateKeyKeyring(),
        },
      },
    ],
  });
  keyring.onPayloadUpdated((payload) => {
    vault.setPayload(payload);
  });
  keyring.attach();

  const approvalsController = createApprovalsController();
  const controllers = {
    ...createControllers(),
    accounts: accountsController,
    approvals: approvalsController,
  } as unknown as HandlerControllers;

  const session = {
    unlock,
    withVaultMetaPersistHold: async <T>(fn: () => Promise<T>) => await fn(),
    vault: {
      getStatus: () => ({ isUnlocked: vault.isUnlocked(), hasCiphertext }),
      initialize: async (params: { password: string }) => {
        void params;
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
  type UiBridgeDeps = Parameters<typeof createUiBridge>[0];
  const bridge = createUiBridge({
    browser: browserApi as unknown as UiBridgeDeps["browser"],
    controllers,
    session,
    rpcClients: {
      getClient: (params?: unknown) => {
        void params;
        return {
          getBalance: vi.fn(async () => "0x0"),
        } as unknown;
      },
    } as unknown as UiBridgeDeps["rpcClients"],
    rpcRegistry,
    persistVaultMeta,
    keyring,
    attention: { getSnapshot: () => ({ queue: [], count: 0 }) } as unknown as UiBridgeDeps["attention"],
  });

  return { bridge, keyring, vault, unlock, approvals: approvalsController, browser: browserApi, persistVaultMeta };
};

const createPort = () => new FakePort();

const isRecord = (value: unknown): value is Record<string, unknown> => {
  return typeof value === "object" && value !== null;
};

const expectError = (msg: unknown, reason: string) => {
  if (!isRecord(msg)) throw new Error("Expected ui:error envelope to be an object");
  const error = isRecord(msg.error) ? msg.error : null;
  expect(msg.type).toBe("ui:error");
  expect(error?.reason).toBe(reason);
};

const expectResponse = <T = unknown>(msg: unknown, id: string): T => {
  if (!isRecord(msg)) throw new Error("Expected ui:response envelope to be an object");
  expect(msg.type).toBe("ui:response");
  expect(msg.id).toBe(id);
  return msg.result as T;
};

const latestSnapshotFromMessages = (messages: unknown[]) => {
  const events = messages.filter((m) => isRecord(m) && m.type === "ui:event" && m.event === UI_EVENT_SNAPSHOT_CHANGED);
  const last = events.at(-1);
  if (!last || !isRecord(last)) throw new Error("Expected at least one snapshotChanged event");
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
    bridge.attachPort(port as unknown as UiPort);
    bridge.attachListeners();
    port.messages = []; // drop initial snapshot
  });

  const send = async <M extends UiMethodName>(method: M, params?: UiMethodParams<M>) => {
    const id = crypto.randomUUID();
    const envelope: UiPortEnvelope = { type: "ui:request", id, method, params };
    await port.triggerMessage(envelope);
    const message = port.messages.find((m) => {
      if (!isRecord(m)) return false;
      if (m.id !== id) return false;
      return m.type === "ui:response" || m.type === "ui:error";
    });
    if (!message) throw new Error(`Expected response for ${method}`);
    return { envelope: message, id };
  };

  it("rejects when locked", async () => {
    unlock.setUnlocked(false);
    vault.setUnlocked(false);

    const { envelope } = await send("ui.keyrings.confirmNewMnemonic", {
      words: Array.from({ length: 12 }, () => "word"),
      alias: "test",
    });

    expectError(envelope, ArxReasons.SessionLocked);
  });

  it("onboarding.generateMnemonic works when locked", async () => {
    unlock.setUnlocked(false);
    vault.setUnlocked(false);

    const { envelope, id } = await send("ui.onboarding.generateMnemonic", { wordCount: 12 });
    const res = expectResponse<{ words: string[] }>(envelope, id);
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

    const responseIndex = port.messages.findIndex((m) => isRecord(m) && m.type === "ui:response" && m.id === id);
    expect(responseIndex).toBeGreaterThanOrEqual(0);

    const snapshotEvents = port.messages
      .map((m, idx) => ({ m, idx }))
      .filter(({ m }) => isRecord(m) && m.type === "ui:event" && m.event === UI_EVENT_SNAPSHOT_CHANGED);
    const lastSnapshotEventIndex = snapshotEvents.at(-1)?.idx ?? -1;
    expect(lastSnapshotEventIndex).toBeGreaterThan(responseIndex);

    const snapshot = latestSnapshotFromMessages(port.messages);
    expect(snapshot.vault.initialized).toBe(true);
    expect(snapshot.accounts.totalCount).toBeGreaterThan(0);
  });

  it("maps invalid mnemonic to keyring/invalid_mnemonic", async () => {
    const words = Array.from({ length: 12 }, () => "foo");
    const { envelope } = await send("ui.keyrings.confirmNewMnemonic", { words, alias: "bad" });
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

    const derivedAccountId = toAccountIdFromAddress({ chainRef: CHAIN.chainRef, address: derived.address });

    const hideRes = await send("ui.keyrings.hideHdAccount", { accountId: derivedAccountId });
    expectResponse(hideRes.envelope, hideRes.id);

    const unhideRes = await send("ui.keyrings.unhideHdAccount", { accountId: derivedAccountId });
    expectResponse(unhideRes.envelope, unhideRes.id);

    const exportMnemonic = await send("ui.keyrings.exportMnemonic", { keyringId, password: PASSWORD });
    const exported = expectResponse(exportMnemonic.envelope, exportMnemonic.id) as { words: string[] };
    expect(exported.words.join(" ")).toBe(TEST_MNEMONIC);

    const exportPk = await send("ui.keyrings.exportPrivateKey", {
      accountId: toAccountIdFromAddress({ chainRef: CHAIN.chainRef, address }),
      password: PASSWORD,
    });
    const pkResult = expectResponse(exportPk.envelope, exportPk.id) as { privateKey: string };
    expect(pkResult.privateKey.length).toBe(64);
  });

  it("requires valid password before exporting mnemonic", async () => {
    const words = TEST_MNEMONIC.split(" ");
    const createRes = await send("ui.keyrings.confirmNewMnemonic", { words, alias: "main" });
    const { keyringId } = expectResponse(createRes.envelope, createRes.id) as { keyringId: string };

    const spy = vi.spyOn(vault, "verifyPassword");
    const exportAttempt = await send("ui.keyrings.exportMnemonic", { keyringId, password: "wrong-password" });
    expectError(exportAttempt.envelope, ArxReasons.VaultInvalidPassword);
    expect(spy).toHaveBeenCalledWith("wrong-password");
    spy.mockRestore();
  });

  it("zeroizes private key buffers after export", async () => {
    const words = TEST_MNEMONIC.split(" ");
    const createRes = await send("ui.keyrings.confirmNewMnemonic", { words, alias: "main" });
    const createResult = expectResponse(createRes.envelope, createRes.id) as { keyringId: string; address: string };

    const secret = new Uint8Array([0xde, 0xad, 0xbe, 0xef, ...new Uint8Array(28)]);
    const spy = vi.spyOn(keyring, "exportPrivateKeyByAccountId").mockResolvedValue(secret);

    const exportPk = await send("ui.keyrings.exportPrivateKey", {
      accountId: toAccountIdFromAddress({ chainRef: CHAIN.chainRef, address: createResult.address }),
      password: PASSWORD,
    });
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

    runtimeBrowser.tabs.query.mockImplementation(async (queryInfo: unknown) => {
      if (isRecord(queryInfo) && queryInfo.url) throw new Error("query-by-url failed");
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
