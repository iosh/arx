import { PermissionDeniedError, type PermissionsState, VaultInvalidPasswordError } from "@arx/core";
import {
  createAccountCodecRegistry,
  eip155Codec,
  toAccountKeyFromAddress,
  toCanonicalAddressFromAccountKey,
} from "@arx/core/accounts";
import { ApprovalKinds } from "@arx/core/approvals";
import { EvmHdKeyring, EvmPrivateKeyKeyring } from "@arx/core/keyring";
import type { NamespaceUiBindings } from "@arx/core/namespaces";
import type { RpcHandlerDeps } from "@arx/core/rpc";
import {
  type BackgroundSessionServices,
  KeyringService,
  type SessionLockState,
  type UnlockLockedPayload,
  type UnlockReason,
  type UnlockUnlockedPayload,
} from "@arx/core/runtime";
import { createKeyringExportService, createSessionStatusService } from "@arx/core/services";
import type { AccountKey, AccountRecord, KeyringMetaRecord } from "@arx/core/storage";
import type { TransactionApprovalDecision } from "@arx/core/transactions";
import {
  UI_CHANNEL,
  UI_EVENT_APPROVALS_CHANGED,
  UI_EVENT_ENTRY_CHANGED,
  UI_EVENT_READY,
  UI_EVENT_SESSION_CHANGED,
  type UiAccountMeta,
  type UiBackupStatus,
  type UiKeyringMeta,
  type UiMethodName,
  type UiMethodParams,
  type UiPermissionsSnapshot,
  type UiPortEnvelope,
  type UiTransaction,
} from "@arx/core/ui";
import {
  createUiKeyringsAccess,
  createUiRuntimeAccess,
  createUiSessionAccess,
  createUiWalletSetupAccess,
  type UiRuntimeAccess,
} from "@arx/core/ui/server";
import type { TrustedWalletApi } from "@arx/core/wallet";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ENTRYPOINTS } from "./constants";
import { createUiPlatform } from "./platform/uiPlatform";
import type { UiPort } from "./ui/portHub";
import { createUiActivationExtension } from "./ui/uiActivationExtension";
import { createUiBridge } from "./uiBridge";

type UiBridgeTestTransactionsAccess = {
  requestTransactionApproval: (...args: never[]) => Promise<unknown>;
  rerunApprovalPrepare: (input: { approvalId: string }) => Promise<unknown>;
  updateApprovalDraft: (input: { approvalId: string; edit: unknown }) => Promise<unknown>;
  approveAndSubmitTransaction: (...args: never[]) => Promise<unknown>;
  rejectTransactionApproval: (...args: never[]) => Promise<unknown>;
  getTransactionApproval: (...args: never[]) => unknown;
  getTransaction: (transactionId: string) => Promise<UiTransaction | null>;
  listTransactions: (query?: unknown) => Promise<UiTransaction[]>;
  onTransactionsChanged: (handler: (transactionIds: readonly string[]) => void) => () => void;
  onTransactionApprovalsChanged: (handler: (approvalIds: readonly string[]) => void) => () => void;
};

const accountCodecs = createAccountCodecRegistry([eip155Codec]);

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

type ChainRef = Parameters<typeof toAccountKeyFromAddress>[0]["chainRef"];

type Listener = (msg: unknown) => void;

class FakePort {
  name = UI_CHANNEL;
  messages: unknown[] = [];
  shouldThrowOnPostMessage = false;
  #messageListeners = new Set<Listener>();
  #disconnectListeners = new Set<() => void>();

  postMessage = (msg: unknown) => {
    if (this.shouldThrowOnPostMessage) {
      throw new Error("stale port");
    }
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

  exportSecret() {
    return new Uint8Array(this.#payload);
  }

  setPayload(next: Uint8Array | null) {
    this.#payload = next ? new Uint8Array(next) : new Uint8Array();
  }

  hasUnlockedSecret() {
    return this.#unlocked;
  }

  setUnlocked(next: boolean) {
    this.#unlocked = next;
  }

  async verifyPassword(password: string) {
    if (password !== this.#password) {
      throw new VaultInvalidPasswordError();
    }
  }
}

class FakeUnlock {
  #state: SessionLockState;
  #unlockedHandlers = new Set<(payload: UnlockUnlockedPayload) => void>();
  #lockedHandlers = new Set<(payload: UnlockLockedPayload) => void>();
  #stateHandlers = new Set<(state: SessionLockState) => void>();

  constructor(unlocked = true, autoLockDurationMs = 900_000) {
    const now = Date.now();
    this.#state = unlocked
      ? {
          status: "unlocked",
          unlockedAt: now,
          autoLockDurationMs,
          nextAutoLockAt: now + autoLockDurationMs,
        }
      : {
          status: "locked",
          autoLockDurationMs,
          nextAutoLockAt: null,
        };
  }

  isUnlocked() {
    return this.#state.status === "unlocked";
  }

  getState() {
    return { ...this.#state };
  }

  async unlock(_params: { password: string }) {
    const now = Date.now();
    this.#state = {
      status: "unlocked",
      unlockedAt: now,
      autoLockDurationMs: this.#state.autoLockDurationMs,
      nextAutoLockAt: now + this.#state.autoLockDurationMs,
    };
    for (const fn of this.#unlockedHandlers) fn({ at: now });
    for (const fn of this.#stateHandlers) fn(this.getState());
  }

  lock(reason: UnlockReason) {
    this.#state = { status: "locked", autoLockDurationMs: this.#state.autoLockDurationMs, nextAutoLockAt: null };
    for (const fn of this.#lockedHandlers) fn({ at: Date.now(), reason });
    for (const fn of this.#stateHandlers) fn(this.getState());
  }

  syncVaultStatus() {
    return this.getState();
  }

  scheduleAutoLock(ms?: number) {
    if (this.#state.status !== "unlocked") {
      return null;
    }

    const autoLockDurationMs = ms ?? this.#state.autoLockDurationMs;
    const deadline = Date.now() + autoLockDurationMs;
    this.#state = { ...this.#state, nextAutoLockAt: deadline };
    for (const fn of this.#stateHandlers) fn(this.getState());
    return deadline;
  }

  setAutoLockDuration(durationMs: number) {
    this.#state =
      this.#state.status === "unlocked"
        ? { ...this.#state, autoLockDurationMs: durationMs, nextAutoLockAt: Date.now() + durationMs }
        : { ...this.#state, autoLockDurationMs: durationMs };
    for (const fn of this.#stateHandlers) fn(this.getState());
  }

  onUnlocked(fn: (payload: UnlockUnlockedPayload) => void) {
    this.#unlockedHandlers.add(fn);
    return () => this.#unlockedHandlers.delete(fn);
  }

  onLocked(fn: (payload: UnlockLockedPayload) => void) {
    this.#lockedHandlers.add(fn);
    return () => this.#lockedHandlers.delete(fn);
  }

  onStateChanged(fn: (state: SessionLockState) => void) {
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
    async get(accountKey: AccountKey) {
      return records.find((r) => r.accountKey === accountKey) ?? null;
    },
    async list(_params?: { includeHidden?: boolean }) {
      void _params;
      return [...records];
    },
    async upsert(record: AccountRecord) {
      const next = { ...record };
      records = [...records.filter((r) => r.accountKey !== next.accountKey), next];
    },
    async remove(accountKey: AccountKey) {
      records = records.filter((r) => r.accountKey !== accountKey);
    },
    async removeByKeyringId(keyringId: string) {
      records = records.filter((r) => r.keyringId !== keyringId);
    },
  };
};

const createStoreBackedAccountSelectionService = (deps: {
  accountsStore: ReturnType<typeof createMemoryAccountsStore>;
}) => {
  const toAccountKey = (chainRef: ChainRef, address: string) =>
    toAccountKeyFromAddress({ chainRef, address, accountCodecs });
  const toAddress = (_chainRef: ChainRef, accountKey: AccountKey) =>
    toCanonicalAddressFromAccountKey({ accountKey, accountCodecs });

  let state = {
    namespaces: {
      [CHAIN.namespace]: { accountKeys: [] as AccountKey[], selectedAccountKey: null as AccountKey | null },
    },
  };
  const listeners = new Set<(s: typeof state) => void>();

  const emit = () => {
    for (const fn of listeners) fn({ ...state, namespaces: { ...state.namespaces } });
  };

  const refresh = async () => {
    const rows = await deps.accountsStore.list({ includeHidden: true });
    const all = rows
      .filter((r) => r.namespace === CHAIN.namespace)
      .map((r) => toCanonicalAddressFromAccountKey({ accountKey: r.accountKey, accountCodecs }))
      .filter((a: string) => /^0x[0-9a-f]{40}$/.test(a));

    const uniq = Array.from(new Set(all));
    const accountKeys = uniq.map((addr) => toAccountKey(CHAIN.chainRef, addr));
    const currentSelected = state.namespaces[CHAIN.namespace]?.selectedAccountKey ?? null;
    const selectedAccountKey =
      currentSelected && accountKeys.includes(currentSelected) ? currentSelected : (accountKeys[0] ?? null);
    state = { namespaces: { [CHAIN.namespace]: { accountKeys, selectedAccountKey } } };

    emit();
  };

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

  void refresh();

  return {
    getState: () => ({
      namespaces: structuredClone(state.namespaces),
    }),
    listOwnedForNamespace: (params: { namespace: string; chainRef: string }) => {
      void params.namespace;
      return (state.namespaces[CHAIN.namespace]?.accountKeys ?? []).map((accountKey) => ({
        accountKey,
        namespace: CHAIN.namespace,
        canonicalAddress: toAddress(params.chainRef, accountKey),
        displayAddress: toAddress(params.chainRef, accountKey),
      }));
    },
    getOwnedAccount: (params: { namespace: string; chainRef: string; accountKey: AccountKey }) => {
      void params.namespace;
      return state.namespaces[CHAIN.namespace]?.accountKeys.includes(params.accountKey)
        ? {
            accountKey: params.accountKey,
            namespace: CHAIN.namespace,
            canonicalAddress: toAddress(params.chainRef, params.accountKey),
            displayAddress: toAddress(params.chainRef, params.accountKey),
          }
        : null;
    },
    getAccountKeysForNamespace: (_namespace: string) => state.namespaces[CHAIN.namespace]?.accountKeys ?? [],
    getSelectedAccountKey: (_namespace: string) => state.namespaces[CHAIN.namespace]?.selectedAccountKey ?? null,
    getActiveAccountForNamespace: (params: { namespace: string; chainRef: string }) => {
      void params.namespace;
      const selected = state.namespaces[CHAIN.namespace]?.selectedAccountKey ?? null;
      return selected
        ? {
            accountKey: selected,
            namespace: CHAIN.namespace,
            chainRef: params.chainRef,
            canonicalAddress: toAddress(params.chainRef, selected),
            displayAddress: toAddress(params.chainRef, selected),
          }
        : null;
    },
    setActiveAccount: async (params: { namespace: string; chainRef: string; accountKey?: AccountKey | null }) => {
      void params.namespace;
      const desired = params.accountKey ?? null;
      const current = state.namespaces[CHAIN.namespace]?.accountKeys ?? [];
      const selectedAccountKey = desired && current.includes(desired) ? desired : (current[0] ?? null);
      state = { namespaces: { [CHAIN.namespace]: { accountKeys: [...current], selectedAccountKey } } };
      emit();
      return selectedAccountKey
        ? {
            accountKey: selectedAccountKey,
            namespace: CHAIN.namespace,
            chainRef: params.chainRef,
            canonicalAddress: toAddress(params.chainRef, selectedAccountKey),
            displayAddress: toAddress(params.chainRef, selectedAccountKey),
          }
        : null;
    },
    onStateChanged: (fn: (s: typeof state) => void) => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
  } satisfies RpcHandlerDeps["accounts"];
};

const createAccountSelectionService = () => {
  const toAddress = (_chainRef: ChainRef, accountKey: AccountKey) =>
    toCanonicalAddressFromAccountKey({ accountKey, accountCodecs });

  let state = {
    namespaces: {
      [CHAIN.namespace]: { accountKeys: [] as AccountKey[], selectedAccountKey: null as AccountKey | null },
    },
  };
  const listeners = new Set<(s: typeof state) => void>();

  const emit = () => {
    for (const fn of listeners) fn({ ...state, namespaces: { ...state.namespaces } });
  };

  return {
    getState: () => ({
      namespaces: structuredClone(state.namespaces),
    }),
    listOwnedForNamespace: (params: { namespace: string; chainRef: string }) => {
      void params.namespace;
      return (state.namespaces[CHAIN.namespace]?.accountKeys ?? []).map((accountKey) => ({
        accountKey,
        namespace: CHAIN.namespace,
        canonicalAddress: toAddress(params.chainRef, accountKey),
        displayAddress: toAddress(params.chainRef, accountKey),
      }));
    },
    getOwnedAccount: (params: { namespace: string; chainRef: string; accountKey: AccountKey }) => {
      void params.namespace;
      return state.namespaces[CHAIN.namespace]?.accountKeys.includes(params.accountKey)
        ? {
            accountKey: params.accountKey,
            namespace: CHAIN.namespace,
            canonicalAddress: toAddress(params.chainRef, params.accountKey),
            displayAddress: toAddress(params.chainRef, params.accountKey),
          }
        : null;
    },
    getAccountKeysForNamespace: (_namespace: string) => state.namespaces[CHAIN.namespace]?.accountKeys ?? [],
    getSelectedAccountKey: (_namespace: string) => state.namespaces[CHAIN.namespace]?.selectedAccountKey ?? null,
    getActiveAccountForNamespace: (params: { namespace: string; chainRef: string }) => {
      void params.namespace;
      const selected = state.namespaces[CHAIN.namespace]?.selectedAccountKey ?? null;
      return selected
        ? {
            accountKey: selected,
            namespace: CHAIN.namespace,
            chainRef: params.chainRef,
            canonicalAddress: toAddress(params.chainRef, selected),
            displayAddress: toAddress(params.chainRef, selected),
          }
        : null;
    },
    setActiveAccount: async (params: { namespace: string; chainRef: string; accountKey?: AccountKey | null }) => {
      const ns = CHAIN.namespace;
      void params.namespace;
      const prev = state.namespaces[ns] ?? { accountKeys: [], selectedAccountKey: null };
      const desired = params.accountKey ?? null;
      const selectedAccountKey =
        desired && prev.accountKeys.includes(desired) ? desired : (prev.accountKeys[0] ?? null);
      state = { namespaces: { ...state.namespaces, [ns]: { ...prev, selectedAccountKey } } };
      emit();
      return selectedAccountKey
        ? {
            accountKey: selectedAccountKey,
            namespace: ns,
            chainRef: params.chainRef,
            canonicalAddress: toAddress(params.chainRef, selectedAccountKey),
            displayAddress: toAddress(params.chainRef, selectedAccountKey),
          }
        : null;
    },
    onStateChanged: (fn: (s: typeof state) => void) => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
  } satisfies RpcHandlerDeps["accounts"];
};

const createApprovalQueueService = () => {
  type StubTask = {
    id: string;
    kind: string;
    origin: string;
    namespace?: string;
    chainRef?: string;
    request: unknown;
    createdAt: number;
  };

  let tasks: StubTask[] = [];
  const listeners = new Set<(state: unknown) => void>();
  const createdListeners = new Set<(event: { record: StubTask }) => void>();
  const finishedListeners = new Set<(event: { id: string; status: string }) => void>();

  const getState = () => ({
    pending: tasks.map((task) => ({
      id: task.id,
      kind: task.kind,
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
    onCreated: (fn: (event: { record: StubTask }) => void) => {
      createdListeners.add(fn);
      return () => createdListeners.delete(fn);
    },
    onFinished: (fn: (event: { id: string; status: string }) => void) => {
      finishedListeners.add(fn);
      return () => finishedListeners.delete(fn);
    },
    setPendingTasks: (next: StubTask[]) => {
      const previousIds = new Set(tasks.map((task) => task.id));
      const nextIds = new Set(next.map((task) => task.id));
      tasks = next.map((task) => ({ ...task }));

      for (const task of tasks) {
        if (!previousIds.has(task.id)) {
          for (const fn of createdListeners) {
            fn({ record: task });
          }
        }
      }

      for (const previousId of previousIds) {
        if (!nextIds.has(previousId)) {
          for (const fn of finishedListeners) {
            fn({ id: previousId, status: "cancelled" });
          }
        }
      }

      emit();
    },
  };
};

const createRuntimeServices = () => {
  const accounts = createAccountSelectionService();
  const approvals = createApprovalQueueService();
  const permissionListeners = new Set<(state: PermissionsState) => void>();
  const permissions = {
    getState: () => ({ origins: {} }),
    onStateChanged: (fn: (state: PermissionsState) => void) => {
      permissionListeners.add(fn);
      return () => {
        permissionListeners.delete(fn);
      };
    },
  };
  const chainRpcListeners = new Set<() => void>();
  const chainRpc = {
    getState: () => ({ accesses: [{ chainRef: CHAIN.chainRef, endpoints: [{ url: "https://rpc.example" }] }] }),
    onStateChanged: (fn: () => void) => {
      chainRpcListeners.add(fn);
      return () => chainRpcListeners.delete(fn);
    },
  };
  const mockTransaction = {
    id: "tx-1",
    status: "submitting" as const,
    namespace: CHAIN.namespace,
    chainRef: CHAIN.chainRef,
    source: "wallet-ui" as const,
    origin: "arx://ui",
    account: {
      accountKey: "eip155:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      address: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    },
    submitted: null,
    receipt: null,
    replacement: null,
    terminalReason: null,
    createdAt: 1,
    updatedAt: 1,
  };
  const mockTransactionApproval = {
    approvalId: "approval-id",
    namespace: CHAIN.namespace,
    chainRef: CHAIN.chainRef,
    source: "wallet-ui" as const,
    origin: "arx://ui",
    account: mockTransaction.account,
    review: null,
    prepare: {
      id: "prepare-1",
      status: "ready" as const,
      draftRevision: 0,
      preparedAt: 1,
      expiresAt: null,
      updatedAt: 1,
    },
    createdAt: 1,
    updatedAt: 1,
  };
  const transactionAccess = {
    requestTransactionApproval: vi.fn(async () => ({
      approval: mockTransactionApproval,
      decision: new Promise<TransactionApprovalDecision>(() => {}),
    })),
    updateApprovalDraft: vi.fn(async () => mockTransactionApproval),
    rerunApprovalPrepare: vi.fn(async () => mockTransactionApproval),
    approveAndSubmitTransaction: vi.fn(async () => ({ status: "submitted" as const, transaction: mockTransaction })),
    rejectTransactionApproval: vi.fn(async () => mockTransactionApproval),
    getTransactionApproval: vi.fn(() => null),
    getTransaction: vi.fn(async () => mockTransaction),
    listTransactions: vi.fn(async () => [mockTransaction]),
    onTransactionsChanged: vi.fn(() => () => {}),
    onTransactionApprovalsChanged: vi.fn(() => () => {}),
  } satisfies UiBridgeTestTransactionsAccess;
  const providerTransactionCommands = {
    beginTransactionApproval: vi.fn(async () => ({
      transactionId: "approval-id",
      approvalId: "approval-id",
      waitForSubmission: async () => ({
        submitted: {
          hash: "0x1111111111111111111111111111111111111111111111111111111111111111",
          chainId: CHAIN.chainId,
          from: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        },
      }),
    })),
  };
  const transactionExecution = {
    approveTransaction: vi.fn(async () => null),
    rejectTransaction: vi.fn(async () => {}),
  };
  const transactionRecovery = {
    resumePending: vi.fn(async () => {}),
  };
  const transactionReview = {
    getTransactionApprovalReview: vi.fn(() => ({
      updatedAt: 0,
      details: null,
      prepare: { state: "preparing" as const },
    })),
  };
  const signers = { eip155: { signPersonalMessage: async () => "", signTypedData: async () => "" } };
  const chainViews = {
    findAvailableChainView: () => CHAIN,
    getApprovalReviewChainView: () => CHAIN,
    getActiveChainViewForNamespace: () => CHAIN,
    getSelectedNamespace: () => CHAIN.namespace,
    getSelectedChainView: () => CHAIN,
    requireAvailableChainDefinition: () => ({
      chainRef: CHAIN.chainRef,
      displayName: CHAIN.displayName,
      shortName: CHAIN.shortName,
      nativeCurrency: CHAIN.nativeCurrency,
    }),
    listKnownChainViews: () => [CHAIN],
    listAvailableChainViews: () => [CHAIN],
    buildWalletNetworksSnapshot: () => ({
      selectedNamespace: CHAIN.namespace,
      active: CHAIN.chainRef,
      known: [CHAIN],
      available: [CHAIN],
    }),
  };
  const permissionViews = {
    buildUiPermissionsSnapshot: () => ({ origins: {} }),
  };

  return {
    accounts,
    approvals,
    permissions,
    chainRpc,
    transactionAccess,
    providerTransactionCommands,
    transactionExecution,
    transactionRecovery,
    transactionReview,
    signers,
    chainViews,
    permissionViews,
  };
};

type UiBridgeTestRuntimeServices = ReturnType<typeof createRuntimeServices>;

const bytesToLowerHex = (bytes: Uint8Array): string =>
  Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");

const buildUiKeyringMeta = (record: KeyringMetaRecord): UiKeyringMeta => ({
  id: record.id,
  type: record.type,
  createdAt: record.createdAt,
  ...(record.alias !== undefined ? { alias: record.alias } : {}),
  ...(record.type === "hd"
    ? { backedUp: record.needsBackup !== true, derivedCount: record.nextDerivationIndex ?? 0 }
    : {}),
});

const buildUiAccountMeta = (record: AccountRecord): UiAccountMeta => ({
  accountKey: record.accountKey,
  canonicalAddress: toCanonicalAddressFromAccountKey({ accountKey: record.accountKey, accountCodecs }),
  keyringId: record.keyringId,
  createdAt: record.createdAt,
  ...(record.derivationIndex !== undefined ? { derivationIndex: record.derivationIndex } : {}),
  ...(record.alias !== undefined ? { alias: record.alias } : {}),
  ...(record.hidden !== undefined ? { hidden: record.hidden } : {}),
});

const deriveBackupStatusForTest = (keyring: KeyringService): UiBackupStatus => {
  const pendingHdKeyrings = keyring
    .getKeyrings()
    .filter((meta) => meta.type === "hd" && meta.needsBackup === true)
    .sort((left, right) => left.createdAt - right.createdAt || left.id.localeCompare(right.id));
  const nextHdKeyring = pendingHdKeyrings[0] ?? null;

  return {
    pendingHdKeyringCount: pendingHdKeyrings.length,
    nextHdKeyring: nextHdKeyring
      ? {
          keyringId: nextHdKeyring.id,
          alias: nextHdKeyring.alias ?? null,
        }
      : null,
  };
};

const hasOwnedAccountsForTest = (accounts: UiBridgeTestRuntimeServices["accounts"]): boolean => {
  const state = accounts.getState();
  return Object.values(state.namespaces).some((namespaceState) => namespaceState.accountKeys.length > 0);
};

const createUnexpectedWalletGroup = (group: string) =>
  new Proxy(
    {},
    {
      get(_target, prop) {
        if (typeof prop === "string") {
          return async () => {
            throw new Error(`Unexpected TrustedWalletApi method in uiBridge test: ${group}.${prop}`);
          };
        }

        return undefined;
      },
    },
  );

const createTrustedWalletApiForBridgeTest = (groups: Partial<TrustedWalletApi>): TrustedWalletApi =>
  ({
    session: groups.session ?? createUnexpectedWalletGroup("session"),
    setup: groups.setup ?? createUnexpectedWalletGroup("setup"),
    accounts: groups.accounts ?? createUnexpectedWalletGroup("accounts"),
    networks: groups.networks ?? createUnexpectedWalletGroup("networks"),
    balances: groups.balances ?? createUnexpectedWalletGroup("balances"),
    approvals: groups.approvals ?? createUnexpectedWalletGroup("approvals"),
    keyrings: groups.keyrings ?? createUnexpectedWalletGroup("keyrings"),
    transactions: groups.transactions ?? createUnexpectedWalletGroup("transactions"),
  }) as unknown as TrustedWalletApi;

const createUiAccessForTest = (input: {
  services: UiBridgeTestRuntimeServices;
  session: BackgroundSessionServices;
  keyring: KeyringService;
  platform: ReturnType<typeof createUiPlatform>;
  activationEntries?: Parameters<typeof createUiActivationExtension>[0]["entries"];
  uiOrigin: string;
  walletChainSelection: {
    subscribeChanged: (handler: () => void) => () => void;
  };
  subscribeAttentionStateChanged: (listener: () => void) => () => void;
  attentionSnapshot?: () => { queue: never[]; count: number };
  selectWalletChain?: (chainRef: string) => Promise<void>;
  chainViewsOverride?: Record<string, unknown>;
  permissionViewsOverride?: { buildUiPermissionsSnapshot: () => UiPermissionsSnapshot };
  transactionsAccess?: Partial<UiBridgeTestTransactionsAccess>;
  namespaceBindings?: {
    getUi: (namespace: string) => NamespaceUiBindings | undefined;
    hasTransactionReceiptTracking: (namespace: string) => boolean;
  };
  installSurfaceActivationExtension?: boolean;
}) => {
  const runtimeServices = input.services;
  const sessionStatus = createSessionStatusService({
    unlock: input.session.unlock,
    vault: input.session.vault,
  });
  const keyringExport = createKeyringExportService({
    sessionStatus,
    keyring: input.keyring,
  });
  const sessionAccess = {
    ...createUiSessionAccess({
      session: input.session as BackgroundSessionServices,
      sessionStatus,
      keyring: input.keyring,
    }),
  };
  const keyringsAccess = createUiKeyringsAccess({
    keyring: input.keyring,
    keyringExport,
  });
  const walletSetupAccess = createUiWalletSetupAccess({
    accounts: input.services.accounts,
    session: input.session as BackgroundSessionServices,
    keyring: input.keyring,
  });
  const transactionsAccess = {
    ...input.services.transactionAccess,
    ...input.transactionsAccess,
  } satisfies UiBridgeTestTransactionsAccess;
  const selectedChainView = (input.chainViewsOverride?.getSelectedChainView ??
    runtimeServices.chainViews.getSelectedChainView) as () => typeof CHAIN;
  const walletNetworksSnapshot = (input.chainViewsOverride?.buildWalletNetworksSnapshot ??
    runtimeServices.chainViews.buildWalletNetworksSnapshot) as () => ReturnType<
    typeof runtimeServices.chainViews.buildWalletNetworksSnapshot
  >;
  const namespaceBindings: NonNullable<typeof input.namespaceBindings> = input.namespaceBindings ?? {
    getUi: () => ({
      getNativeBalance: vi.fn(async () => 0n),
    }),
    hasTransactionReceiptTracking: () => false,
  };
  const readChainViews = {
    ...runtimeServices.chainViews,
    ...(input.chainViewsOverride ?? {}),
  } as typeof runtimeServices.chainViews;
  const listAccountsForCurrentChain = () => {
    const selectedChain = selectedChainView();
    const params = {
      namespace: selectedChain.namespace,
      chainRef: selectedChain.chainRef,
    };
    const list = input.services.accounts.listOwnedForNamespace(params).map((account) => ({
      accountKey: account.accountKey,
      canonicalAddress: account.canonicalAddress,
      displayAddress: account.displayAddress,
    }));
    const active = input.services.accounts.getActiveAccountForNamespace(params);
    return {
      totalCount: list.length,
      list,
      active: active
        ? {
            accountKey: active.accountKey,
            canonicalAddress: active.canonicalAddress,
            displayAddress: active.displayAddress,
          }
        : null,
    };
  };
  const read = {
    listKeyrings: () => input.keyring.getKeyrings().map(buildUiKeyringMeta),
    getAccountsByKeyring: ({ keyringId, includeHidden }: { keyringId: string; includeHidden?: boolean }) =>
      input.keyring.getAccountsByKeyring(keyringId, includeHidden ?? false).map(buildUiAccountMeta),
    getBackupStatus: (): UiBackupStatus => deriveBackupStatusForTest(input.keyring),
    getNativeBalance: async ({ accountKey, chainRef }: { accountKey: AccountKey; chainRef: ChainRef }) => {
      const account = input.services.accounts.getOwnedAccount({
        namespace: CHAIN.namespace,
        chainRef,
        accountKey,
      });
      if (!account) {
        throw new PermissionDeniedError();
      }

      const getNativeBalance = namespaceBindings.getUi(CHAIN.namespace)?.getNativeBalance;
      if (!getNativeBalance) {
        throw new Error(`Native balance is not supported for namespace "${CHAIN.namespace}" in uiBridge test`);
      }

      const amount = await getNativeBalance({ chainRef, address: account.canonicalAddress });
      const definition = readChainViews.requireAvailableChainDefinition();
      return {
        accountKey,
        chainRef,
        amount: amount.toString(10),
        currency: { ...definition.nativeCurrency },
      };
    },
    listPendingApprovals: async () => [],
    getApprovalDetail: async (_params: { approvalId: string }) => null,
    listTransactions: async (query: Parameters<UiBridgeTestTransactionsAccess["listTransactions"]>[0]) =>
      await transactionsAccess.listTransactions(query),
    getTransactionDetail: async ({ transactionId }: { transactionId: string }) =>
      await transactionsAccess.getTransaction(transactionId),
    subscribe: (listener: () => void) => {
      const unsubscribers = [
        input.services.accounts.onStateChanged(() => listener()),
        input.services.permissions.onStateChanged(() => listener()),
        input.services.chainRpc.onStateChanged(listener),
        input.walletChainSelection.subscribeChanged(listener),
        sessionAccess.onStateChanged(listener),
        input.subscribeAttentionStateChanged(listener),
      ];
      return () => {
        for (const unsubscribe of unsubscribers) {
          unsubscribe();
        }
      };
    },
  };
  const wallet = createTrustedWalletApiForBridgeTest({
    session: {
      getStatus: () => sessionStatus.getStatus(),
      unlock: (input) => sessionAccess.unlock(input),
      lock: async (input) => sessionAccess.lock(input?.reason ?? "manual"),
      resetAutoLockTimer: async () => input.session.unlock.syncVaultStatus(),
      setAutoLockDuration: async ({ durationMs }) => {
        input.session.unlock.setAutoLockDuration(durationMs);
        const nextAutoLockAt = input.session.unlock.scheduleAutoLock(durationMs);
        return { autoLockDurationMs: durationMs, nextAutoLockAt };
      },
    },
    setup: {
      getStatus: () => {
        const vaultInitialized = sessionStatus.hasInitializedVault();
        return {
          availability: !vaultInitialized
            ? "uninitialized"
            : hasOwnedAccountsForTest(input.services.accounts)
              ? "ready"
              : "empty",
        };
      },
      generateMnemonic: (params) =>
        Promise.resolve({ words: input.keyring.generateMnemonic(params?.wordCount ?? 12).split(" ") }),
      createWalletFromMnemonic: async ({ password, words, alias, skipBackup, namespace }) =>
        await walletSetupAccess.createWalletFromMnemonic({
          password,
          mnemonic: words.join(" "),
          ...(alias !== undefined ? { alias } : {}),
          ...(skipBackup !== undefined ? { skipBackup } : {}),
          ...(namespace !== undefined ? { namespace } : {}),
        }),
      importWalletFromMnemonic: async ({ password, words, alias, namespace }) =>
        await walletSetupAccess.createWalletFromMnemonic({
          password,
          mnemonic: words.join(" "),
          ...(alias !== undefined ? { alias } : {}),
          ...(namespace !== undefined ? { namespace } : {}),
        }),
      importWalletFromPrivateKey: async () => {
        throw new Error("Unexpected TrustedWalletApi method in uiBridge test: setup.importWalletFromPrivateKey");
      },
    },
    accounts: {
      listCurrentChain: () => listAccountsForCurrentChain(),
      switchActive: async ({ chainRef, accountKey }) =>
        await input.services.accounts.setActiveAccount({
          namespace: CHAIN.namespace,
          chainRef,
          accountKey,
        }),
    },
    networks: {
      getSelectedChain: () => selectedChainView(),
      list: () => walletNetworksSnapshot(),
      select: async ({ chainRef }) => {
        await (input.selectWalletChain ?? vi.fn(async () => {}))(chainRef);
        return {
          chainRef,
          namespace: CHAIN.namespace,
          displayName: CHAIN.displayName,
          shortName: CHAIN.shortName,
          icon: null,
          nativeCurrency: CHAIN.nativeCurrency,
        };
      },
    },
    balances: {
      getNative: (params) => read.getNativeBalance(params),
    },
    approvals: {
      listPending: () => read.listPendingApprovals(),
      getDetail: (params) => read.getApprovalDetail(params),
      resolve: async () => null,
    },
    keyrings: {
      list: () => read.listKeyrings(),
      getAccountsByKeyring: (params) => read.getAccountsByKeyring(params),
      getBackupStatus: () => read.getBackupStatus(),
      confirmNewMnemonic: async ({ words, alias, skipBackup, namespace }) => {
        const result = await keyringsAccess.confirmNewMnemonic({
          mnemonic: words.join(" "),
          ...(alias !== undefined ? { alias } : {}),
          ...(skipBackup !== undefined ? { skipBackup } : {}),
          ...(namespace !== undefined ? { namespace } : {}),
        });
        await input.services.accounts.setActiveAccount({
          namespace: namespace ?? CHAIN.namespace,
          chainRef: CHAIN.chainRef,
          accountKey: toAccountKeyFromAddress({ chainRef: CHAIN.chainRef, address: result.address, accountCodecs }),
        });
        return result;
      },
      importMnemonic: async ({ words, alias, namespace }) =>
        await keyringsAccess.confirmNewMnemonic({
          mnemonic: words.join(" "),
          ...(alias !== undefined ? { alias } : {}),
          ...(namespace !== undefined ? { namespace } : {}),
        }),
      importPrivateKey: async () => {
        throw new Error("Unexpected TrustedWalletApi method in uiBridge test: keyrings.importPrivateKey");
      },
      deriveAccount: async ({ keyringId }) => {
        return await keyringsAccess.deriveAccount(keyringId);
      },
      renameKeyring: async () => null,
      renameAccount: async () => null,
      markBackedUp: async () => null,
      hideHdAccount: async ({ accountKey }) => {
        const active = input.services.accounts.getActiveAccountForNamespace({
          namespace: CHAIN.namespace,
          chainRef: CHAIN.chainRef,
        });
        if (active?.accountKey === accountKey) {
          throw new PermissionDeniedError();
        }
        await keyringsAccess.hideHdAccount(accountKey);
        return null;
      },
      unhideHdAccount: async ({ accountKey }) => {
        await keyringsAccess.unhideHdAccount(accountKey);
        return null;
      },
      removePrivateKeyKeyring: async () => null,
      exportMnemonic: async ({ keyringId, password }) => ({
        words: (await keyringsAccess.exportMnemonic(keyringId, password)).split(" "),
      }),
      exportPrivateKey: async ({ accountKey, password }) => {
        const bytes = await keyringsAccess.exportPrivateKeyByAccountKey(accountKey, password);
        return { privateKey: bytesToLowerHex(bytes) };
      },
    },
    transactions: {
      listHistory: (query) => read.listTransactions(query),
      getDetail: (params) => read.getTransactionDetail(params),
      requestSendTransactionApproval: async () => ({ approvalId: "approval-id" }),
      rerunPrepare: async (params) => {
        await transactionsAccess.rerunApprovalPrepare(params);
        return null;
      },
      applyDraftEdit: async (params) => {
        await transactionsAccess.updateApprovalDraft(params);
        return null;
      },
    },
  });
  const activationEntries = input.activationEntries ?? {
    ...input.platform,
    getEntryLaunchContext: ({ environment }: { environment: "popup" | "notification" | "onboarding" }) => ({
      environment,
      reason:
        environment === "onboarding" ? "onboarding_required" : environment === "notification" ? "idle" : "manual_open",
      context: {
        approvalId: null,
        origin: null,
        method: null,
        chainRef: null,
        namespace: null,
      },
    }),
    getEntryBootstrap: ({ environment }: { environment: "popup" | "notification" | "onboarding" }) => ({
      entry: {
        environment,
        reason:
          environment === "onboarding"
            ? "onboarding_required"
            : environment === "notification"
              ? "idle"
              : "manual_open",
        context: {
          approvalId: null,
          origin: null,
          method: null,
          chainRef: null,
          namespace: null,
        },
      },
      requestedApproval: null,
    }),
  };

  return createUiRuntimeAccess({
    server: {
      wallet,
      events: {
        onSessionChanged: (handler) => sessionAccess.onStateChanged(handler),
        onApprovalCreated: (handler) => input.services.approvals.onCreated(() => handler()),
        onApprovalFinished: (handler) =>
          input.services.approvals.onFinished((event) => handler({ approvalId: event.id })),
        onTransactionApprovalsChanged: (handler) => transactionsAccess.onTransactionApprovalsChanged(handler),
        onTransactionsChanged: (handler) => transactionsAccess.onTransactionsChanged(handler),
      },
      platform: input.platform,
      uiOrigin: input.uiOrigin,
      ...(input.installSurfaceActivationExtension === false
        ? {}
        : { extensions: [createUiActivationExtension({ entries: activationEntries })] }),
    },
  });
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

const buildBridge = (opts?: {
  unlocked?: boolean;
  hasEnvelope?: boolean;
  installSurfaceActivationExtension?: boolean;
}) => {
  const vault = new FakeVault(new Uint8Array(), opts?.unlocked ?? true);
  const unlock = new FakeUnlock(opts?.unlocked ?? true);
  const keyringMetas = createMemoryKeyringMetasStore();
  const accountsStore = createMemoryAccountsStore();
  const accountSelectionService = createStoreBackedAccountSelectionService({ accountsStore });
  let hasEnvelope = opts?.hasEnvelope ?? true;

  const keyring = new KeyringService({
    now: () => Date.now(),
    uuid: () => crypto.randomUUID(),
    vault: {
      exportSecret: () => vault.exportSecret(),
      getStatus: () => ({ status: vault.hasUnlockedSecret() ? "unlocked" : "locked" }),
      verifyPassword: (pwd: string) => vault.verifyPassword(pwd),
    },
    unlock,
    accountsStore,
    keyringMetas,
    namespaces: [
      {
        namespace: CHAIN.namespace,
        defaultChainRef: CHAIN.chainRef,
        codec: accountCodecs.require(CHAIN.namespace),
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

  const approvalQueueService = createApprovalQueueService();
  const runtimeServices = {
    ...createRuntimeServices(),
    accounts: accountSelectionService,
    approvals: approvalQueueService,
  };

  const session = {
    onStateChanged: (listener: () => void) => unlock.onStateChanged(() => listener()),
    unlock,
    withVaultMetaPersistHold: async <T>(fn: () => Promise<T>) => await fn(),
    createVault: async (params: { password: string }) => {
      void params;
      hasEnvelope = true;
      vault.setUnlocked(false);
      unlock.setUnlocked(false);
      return {
        version: 1,
        kdf: { name: "pbkdf2", hash: "sha256", salt: "salt", iterations: 1 },
        cipher: { name: "aes-gcm", iv: "iv", data: "data" },
      };
    },
    importVault: async (envelope: Parameters<BackgroundSessionServices["importVault"]>[0]) => {
      hasEnvelope = true;
      vault.setUnlocked(false);
      unlock.setUnlocked(false);
      return envelope;
    },
    vault: {
      getStatus: () => ({
        status: vault.hasUnlockedSecret() ? "unlocked" : hasEnvelope ? "locked" : "uninitialized",
      }),
      initialize: async (params: { password: string }) => {
        void params;
        hasEnvelope = true;
        return {
          version: 1,
          kdf: { name: "pbkdf2", hash: "sha256", salt: "salt", iterations: 1 },
          cipher: { name: "aes-gcm", iv: "iv", data: "data" },
        };
      },
      verifyPassword: (pwd: string) => vault.verifyPassword(pwd),
    },
  } as unknown as BackgroundSessionServices;

  const browserApi = makeBrowser();
  const platform = createUiPlatform({
    browser: browserApi as unknown as Parameters<typeof createUiPlatform>[0]["browser"],
    entrypoints: ENTRYPOINTS,
  });
  const attentionStateHandlers = new Set<() => void>();
  const walletChainSelectionListeners = new Set<() => void>();
  const walletChainSelection = {
    subscribeChanged: (handler: () => void) => {
      walletChainSelectionListeners.add(handler);
      return () => walletChainSelectionListeners.delete(handler);
    },
  };
  const uiAccess = createUiAccessForTest({
    services: runtimeServices,
    session,
    keyring,
    platform,
    uiOrigin: new URL(browserApi.runtime.getURL("")).origin,
    installSurfaceActivationExtension: opts?.installSurfaceActivationExtension,
    walletChainSelection,
    transactionsAccess: runtimeServices.transactionAccess,
    subscribeAttentionStateChanged: (listener) => {
      attentionStateHandlers.add(listener);
      return () => attentionStateHandlers.delete(listener);
    },
  });
  const bridge = createUiBridge({ uiAccess });

  return {
    bridge,
    keyring,
    vault,
    unlock,
    approvals: approvalQueueService,
    browser: browserApi,
    emitWalletChainSelectionChanged: () => {
      for (const handler of walletChainSelectionListeners) {
        handler();
      }
    },
    emitAttentionStateChanged: () => {
      for (const handler of attentionStateHandlers) {
        handler();
      }
    },
  };
};

const createPort = () => new FakePort();

const isRecord = (value: unknown): value is Record<string, unknown> => {
  return typeof value === "object" && value !== null;
};

const expectError = (msg: unknown, code: string) => {
  if (!isRecord(msg)) throw new Error("Expected ui:error envelope to be an object");
  const error = isRecord(msg.error) ? msg.error : null;
  expect(msg.type).toBe("ui:error");
  expect(error?.code).toBe(code);
};

const expectResponse = <T = unknown>(msg: unknown, id: string): T => {
  if (!isRecord(msg)) throw new Error("Expected ui:response envelope to be an object");
  expect(msg.type).toBe("ui:response");
  expect(msg.id).toBe(id);
  return msg.result as T;
};

const findEvent = (messages: unknown[], event: string) => {
  return messages.find((message) => isRecord(message) && message.type === "ui:event" && message.event === event);
};

describe("uiBridge", () => {
  let bridge: ReturnType<typeof buildBridge>["bridge"];
  let keyring: ReturnType<typeof buildBridge>["keyring"];
  let vault: FakeVault;
  let unlock: FakeUnlock;
  let approvals: ReturnType<typeof buildBridge>["approvals"];
  let port: FakePort;
  let runtimeBrowser: ReturnType<typeof makeBrowser>;
  let _emitWalletChainSelectionChanged: ReturnType<typeof buildBridge>["emitWalletChainSelectionChanged"];

  beforeEach(() => {
    const ctx = buildBridge({ unlocked: true });
    bridge = ctx.bridge;
    keyring = ctx.keyring;
    vault = ctx.vault;
    unlock = ctx.unlock;
    approvals = ctx.approvals;
    runtimeBrowser = ctx.browser;
    _emitWalletChainSelectionChanged = ctx.emitWalletChainSelectionChanged;

    port = createPort();
    bridge.attachPort(port as unknown as UiPort);
    port.messages = []; // drop ready handshake
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

    expectError(envelope, "global.session.locked");
  });

  it("onboarding.generateMnemonic works when locked", async () => {
    unlock.setUnlocked(false);
    vault.setUnlocked(false);

    const { envelope, id } = await send("ui.onboarding.generateMnemonic", { wordCount: 12 });
    const res = expectResponse<{ words: string[] }>(envelope, id);
    expect(res.words).toHaveLength(12);
  });

  it("onboarding.createWalletFromMnemonic initializes onboarding wallet state", async () => {
    // Default test setup starts with a vault that has ciphertext but no accounts.
    const id = crypto.randomUUID();
    const words = TEST_MNEMONIC.split(" ");

    await port.triggerMessage({
      type: "ui:request",
      id,
      method: "ui.onboarding.createWalletFromMnemonic",
      params: { password: PASSWORD, words, skipBackup: true },
    } satisfies UiPortEnvelope);

    const responseIndex = port.messages.findIndex((m) => isRecord(m) && m.type === "ui:response" && m.id === id);
    expect(responseIndex).toBeGreaterThanOrEqual(0);

    const status = await send("ui.onboarding.getStatus");
    expect(expectResponse(status.envelope, status.id)).toEqual({
      availability: "ready",
    });
  });

  it("session.lock emits sessionChanged", async () => {
    const id = crypto.randomUUID();

    await port.triggerMessage({
      type: "ui:request",
      id,
      method: "ui.session.lock",
    } satisfies UiPortEnvelope);

    const responseIndex = port.messages.findIndex((m) => isRecord(m) && m.type === "ui:response" && m.id === id);
    expect(responseIndex).toBeGreaterThanOrEqual(0);

    const sessionChangedIndex = port.messages.findIndex(
      (m) => isRecord(m) && m.type === "ui:event" && m.event === UI_EVENT_SESSION_CHANGED,
    );
    expect(sessionChangedIndex).toBeGreaterThanOrEqual(0);

    const status = await send("ui.session.getStatus");
    expect(expectResponse(status.envelope, status.id)).toMatchObject({ isUnlocked: false });
  });

  it("does not block ui events behind slow queries", async () => {
    const uiEventListeners = new Set<(event: { type: "ui:event"; event: string; payload: unknown }) => void>();
    let resolveDispatch!: (value: Awaited<ReturnType<UiRuntimeAccess["dispatchRequest"]>>) => void;
    let hasPendingDispatch = false;

    const uiAccess: UiRuntimeAccess = {
      dispatchRequest: vi.fn(
        () =>
          new Promise<Awaited<ReturnType<UiRuntimeAccess["dispatchRequest"]>>>((resolve) => {
            resolveDispatch = resolve;
            hasPendingDispatch = true;
          }),
      ),
      subscribeUiEvents: vi.fn((listener) => {
        uiEventListeners.add(listener);
        return () => uiEventListeners.delete(listener);
      }),
    };
    const bridge = createUiBridge({ uiAccess });
    const queryPort = createPort();
    const observerPort = createPort();

    bridge.attachPort(queryPort as unknown as UiPort);
    bridge.attachPort(observerPort as unknown as UiPort);
    queryPort.messages = [];
    observerPort.messages = [];

    const pendingQuery = queryPort.triggerMessage({
      type: "ui:request",
      id: "req-query",
      method: "ui.keyrings.list",
    });
    await vi.waitFor(() => expect(hasPendingDispatch).toBe(true));

    for (const listener of uiEventListeners) {
      listener({
        type: "ui:event",
        event: UI_EVENT_SESSION_CHANGED,
        payload: { reason: "changed" },
      });
    }

    expect(observerPort.messages).toContainEqual(
      expect.objectContaining({
        type: "ui:event",
        event: UI_EVENT_SESSION_CHANGED,
        payload: { reason: "changed" },
      }),
    );
    expect(queryPort.messages).not.toContainEqual(expect.objectContaining({ type: "ui:response", id: "req-query" }));

    resolveDispatch({
      reply: {
        type: "ui:response",
        id: "req-query",
        result: [],
        context: { namespace: CHAIN.namespace, chainRef: CHAIN.chainRef },
      },
      kind: "query",
    });
    await pendingQuery;

    const queryEventIndex = queryPort.messages.findIndex(
      (message) => isRecord(message) && message.type === "ui:event" && message.event === UI_EVENT_SESSION_CHANGED,
    );
    const queryResponseIndex = queryPort.messages.findIndex(
      (message) => isRecord(message) && message.type === "ui:response" && message.id === "req-query",
    );

    expect(queryEventIndex).toBeGreaterThanOrEqual(0);
    expect(queryResponseIndex).toBeGreaterThan(queryEventIndex);
  });

  it("drops a stale port without affecting approval broadcasts to other attached ports", () => {
    const stalePort = createPort();
    const healthyPort = createPort();

    bridge.attachPort(stalePort as unknown as UiPort);
    bridge.attachPort(healthyPort as unknown as UiPort);

    stalePort.messages = [];
    healthyPort.messages = [];
    stalePort.shouldThrowOnPostMessage = true;

    approvals.setPendingTasks([
      {
        id: crypto.randomUUID(),
        kind: ApprovalKinds.RequestAccounts,
        origin: "https://example.com",
        namespace: CHAIN.namespace,
        chainRef: CHAIN.chainRef,
        request: { suggestedAccounts: [] },
        createdAt: Date.now(),
      },
    ]);

    expect(healthyPort.messages).toContainEqual(
      expect.objectContaining({
        type: "ui:event",
        event: UI_EVENT_APPROVALS_CHANGED,
      }),
    );
    expect(stalePort.messages).toEqual([]);

    healthyPort.messages = [];
    approvals.setPendingTasks([]);

    expect(healthyPort.messages).toContainEqual(
      expect.objectContaining({
        type: "ui:event",
        event: UI_EVENT_APPROVALS_CHANGED,
      }),
    );
    expect(stalePort.messages).toEqual([]);
  });

  it("sends ready without reading selected-chain state", () => {
    const browserApi = makeBrowser();
    const platform = createUiPlatform({
      browser: browserApi as unknown as Parameters<typeof createUiPlatform>[0]["browser"],
      entrypoints: ENTRYPOINTS,
    });
    const runtimeServices = createRuntimeServices();
    const attentionStateHandlers = new Set<() => void>();

    const uiAccess = createUiAccessForTest({
      services: runtimeServices,
      session: {
        onStateChanged: () => () => {},
        unlock: new FakeUnlock(true),
        withVaultMetaPersistHold: async <T>(fn: () => Promise<T>) => await fn(),
        persistVaultMeta: vi.fn(async () => {}),
        createVault: vi.fn(async () => ({
          version: 1 as const,
          kdf: { name: "pbkdf2" as const, hash: "sha256" as const, salt: "salt", iterations: 1 },
          cipher: { name: "aes-gcm" as const, iv: "iv", data: "data" },
        })),
        importVault: vi.fn(async (envelope: Parameters<BackgroundSessionServices["importVault"]>[0]) => envelope),
        vault: {
          getStatus: () => ({ status: "unlocked" }),
        },
      } as unknown as BackgroundSessionServices,
      keyring,
      platform,
      uiOrigin: new URL(browserApi.runtime.getURL("")).origin,
      walletChainSelection: {
        subscribeChanged: () => () => {},
      },
      subscribeAttentionStateChanged: (listener) => {
        attentionStateHandlers.add(listener);
        return () => attentionStateHandlers.delete(listener);
      },
      chainViewsOverride: {
        ...runtimeServices.chainViews,
        getSelectedNamespace: () => CHAIN.namespace,
        getSelectedChainView: () => {
          throw new Error("selected chain temporarily unavailable");
        },
        buildWalletNetworksSnapshot: () => {
          throw new Error("selected chain temporarily unavailable");
        },
      },
    });
    const bridge = createUiBridge({ uiAccess });

    const port = createPort();
    bridge.attachPort(port as unknown as UiPort);

    expect(port.messages).toContainEqual(
      expect.objectContaining({
        type: "ui:event",
        event: UI_EVENT_READY,
        payload: { ready: true },
      }),
    );
  });

  it("maps invalid mnemonic to keyring/invalid_mnemonic", async () => {
    const words = Array.from({ length: 12 }, () => "foo");
    const { envelope } = await send("ui.keyrings.confirmNewMnemonic", { words, alias: "bad" });
    expectError(envelope, "keyring.invalid_mnemonic");
  });

  it("maps duplicate mnemonic to keyring/duplicate_account", async () => {
    const words = TEST_MNEMONIC.split(" ");
    const first = await send("ui.keyrings.confirmNewMnemonic", { words, alias: "first" });
    expectResponse(first.envelope, first.id);

    const second = await send("ui.keyrings.confirmNewMnemonic", { words, alias: "dup" });
    expectError(second.envelope, "keyring.duplicate_account");
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

    const derivedAccountKey = toAccountKeyFromAddress({
      chainRef: CHAIN.chainRef,
      address: derived.address,
      accountCodecs,
    });

    const hideRes = await send("ui.keyrings.hideHdAccount", { accountKey: derivedAccountKey });
    expectResponse(hideRes.envelope, hideRes.id);

    const unhideRes = await send("ui.keyrings.unhideHdAccount", { accountKey: derivedAccountKey });
    expectResponse(unhideRes.envelope, unhideRes.id);

    const exportMnemonic = await send("ui.keyrings.exportMnemonic", { keyringId, password: PASSWORD });
    const exported = expectResponse(exportMnemonic.envelope, exportMnemonic.id) as { words: string[] };
    expect(exported.words.join(" ")).toBe(TEST_MNEMONIC);

    const exportPk = await send("ui.keyrings.exportPrivateKey", {
      accountKey: toAccountKeyFromAddress({ chainRef: CHAIN.chainRef, address, accountCodecs }),
      password: PASSWORD,
    });
    const pkResult = expectResponse(exportPk.envelope, exportPk.id) as { privateKey: string };
    expect(pkResult.privateKey.length).toBe(64);
  });

  it("rejects hiding the active account", async () => {
    const words = TEST_MNEMONIC.split(" ");
    const createRes = await send("ui.keyrings.confirmNewMnemonic", { words, alias: "main" });
    const createResult = expectResponse(createRes.envelope, createRes.id) as { address: string };
    const activeAccountKey = toAccountKeyFromAddress({
      chainRef: CHAIN.chainRef,
      address: createResult.address,
      accountCodecs,
    });

    const hideRes = await send("ui.keyrings.hideHdAccount", { accountKey: activeAccountKey });
    expectError(hideRes.envelope, "global.permission.denied");
  });

  it("requires valid password before exporting mnemonic", async () => {
    const words = TEST_MNEMONIC.split(" ");
    const createRes = await send("ui.keyrings.confirmNewMnemonic", { words, alias: "main" });
    const { keyringId } = expectResponse(createRes.envelope, createRes.id) as { keyringId: string };

    const spy = vi.spyOn(vault, "verifyPassword");
    const exportAttempt = await send("ui.keyrings.exportMnemonic", { keyringId, password: "wrong-password" });
    expectError(exportAttempt.envelope, "vault.invalid_password");
    expect(spy).toHaveBeenCalledWith("wrong-password");
    spy.mockRestore();
  });

  it("rejects key exports while locked before password verification", async () => {
    const words = TEST_MNEMONIC.split(" ");
    const createRes = await send("ui.keyrings.confirmNewMnemonic", { words, alias: "main" });
    const { keyringId } = expectResponse(createRes.envelope, createRes.id) as { keyringId: string };

    unlock.setUnlocked(false);
    vault.setUnlocked(false);

    const spy = vi.spyOn(vault, "verifyPassword");
    const exportAttempt = await send("ui.keyrings.exportMnemonic", { keyringId, password: PASSWORD });
    expectError(exportAttempt.envelope, "global.session.locked");
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it("exports private keys as lower-case hex", async () => {
    const words = TEST_MNEMONIC.split(" ");
    const createRes = await send("ui.keyrings.confirmNewMnemonic", { words, alias: "main" });
    const createResult = expectResponse(createRes.envelope, createRes.id) as { keyringId: string; address: string };

    const secret = new Uint8Array([0xde, 0xad, 0xbe, 0xef, ...new Uint8Array(28)]);
    const spy = vi.spyOn(keyring, "exportPrivateKeyByAccountKey").mockResolvedValue(secret);

    const exportPk = await send("ui.keyrings.exportPrivateKey", {
      accountKey: toAccountKeyFromAddress({
        chainRef: CHAIN.chainRef,
        address: createResult.address,
        accountCodecs,
      }),
      password: PASSWORD,
    });
    const pkResult = expectResponse(exportPk.envelope, exportPk.id) as { privateKey: string };

    expect(pkResult.privateKey).toBe(`deadbeef${"00".repeat(28)}`);
    spy.mockRestore();
  });

  it("approval changes emit approval events without wallet state payloads", async () => {
    port.messages = [];
    const id = crypto.randomUUID();
    approvals.setPendingTasks([
      {
        id,
        kind: ApprovalKinds.RequestAccounts,
        origin: "https://example.com",
        namespace: CHAIN.namespace,
        chainRef: CHAIN.chainRef,
        request: { suggestedAccounts: [] },
        createdAt: Date.now(),
      },
    ]);

    const approvalEvent = port.messages.find(
      (message) => isRecord(message) && message.type === "ui:event" && message.event === UI_EVENT_APPROVALS_CHANGED,
    );
    expect(approvalEvent).toBeDefined();
    expect(approvalEvent).toMatchObject({ payload: { reason: "changed" } });
  });

  it("session.unlock triggers sessionChanged with unlocked status available by query", async () => {
    unlock.setUnlocked(false);
    vault.setUnlocked(false);
    port.messages = [];

    const res = await send("ui.session.unlock", { password: PASSWORD });
    expectResponse(res.envelope, res.id);

    expect(findEvent(port.messages, UI_EVENT_SESSION_CHANGED)).toBeDefined();

    const status = await send("ui.session.getStatus");
    expect(expectResponse(status.envelope, status.id)).toMatchObject({ isUnlocked: true });
  });

  it("onboarding.openTab: creates then debounces within cooldown", async () => {
    let t = 0;
    const nowSpy = vi.spyOn(Date, "now").mockImplementation(() => t);

    runtimeBrowser.tabs.query.mockResolvedValueOnce([]);
    runtimeBrowser.tabs.create.mockResolvedValueOnce({ id: 1, windowId: 2 });

    const first = await send("ui.onboarding.openTab", { reason: "manual_open" });
    expect(expectResponse(first.envelope, first.id)).toMatchObject({ activationPath: "create", tabId: 1 });
    expect(runtimeBrowser.tabs.create).toHaveBeenCalledWith({
      url: "ext://onboarding.html",
      active: true,
    });

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

  it("entry.getLaunchContext returns runtime-owned entry metadata", async () => {
    const res = await send("ui.entry.getLaunchContext", { environment: "notification" });

    expect(expectResponse(res.envelope, res.id)).toEqual({
      environment: "notification",
      reason: "idle",
      context: {
        approvalId: null,
        origin: null,
        method: null,
        chainRef: null,
        namespace: null,
      },
    });
  });

  it("broadcasts entry-changed events to attached UI ports", () => {
    const ctx = buildBridge({ unlocked: true });
    const localPort = createPort();

    ctx.bridge.attachPort(localPort as unknown as UiPort);
    localPort.messages = [];

    ctx.bridge.broadcastEvent({
      type: "ui:event",
      event: UI_EVENT_ENTRY_CHANGED,
      payload: {
        environment: "notification",
        reason: "approval_created",
        context: {
          approvalId: "approval-1",
          origin: "https://dapp.example",
          method: "eth_requestAccounts",
          chainRef: "eip155:1",
          namespace: "eip155",
        },
      },
    });

    expect(localPort.messages).toContainEqual({
      type: "ui:event",
      event: UI_EVENT_ENTRY_CHANGED,
      payload: {
        environment: "notification",
        reason: "approval_created",
        context: {
          approvalId: "approval-1",
          origin: "https://dapp.example",
          method: "eth_requestAccounts",
          chainRef: "eip155:1",
          namespace: "eip155",
        },
      },
    });
  });

  it("returns unsupported when surface activation extension is not installed", async () => {
    const ctx = buildBridge({ unlocked: true, installSurfaceActivationExtension: false });
    const localPort = createPort();

    ctx.bridge.attachPort(localPort as unknown as UiPort);
    localPort.messages = [];

    const id = crypto.randomUUID();
    await localPort.triggerMessage({
      type: "ui:request",
      id,
      method: "ui.onboarding.openTab",
      params: { reason: "manual_open" },
    });

    const message = localPort.messages.find((entry) => isRecord(entry) && entry.id === id);
    expectError(message, "global.rpc.unsupported_method");
  });

  it("returns unsupported before validating params when surface activation extension is not installed", async () => {
    const ctx = buildBridge({ unlocked: true, installSurfaceActivationExtension: false });
    const localPort = createPort();

    ctx.bridge.attachPort(localPort as unknown as UiPort);
    localPort.messages = [];

    const id = crypto.randomUUID();
    await localPort.triggerMessage({
      type: "ui:request",
      id,
      method: "ui.onboarding.openTab",
      params: {},
    });

    const message = localPort.messages.find((entry) => isRecord(entry) && entry.id === id);
    expectError(message, "global.rpc.unsupported_method");
  });
});
