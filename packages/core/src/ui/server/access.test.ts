import { describe, expect, it, vi } from "vitest";
import type { TrustedWalletApi } from "../../wallet/api.js";
import {
  UI_EVENT_APPROVAL_DETAIL_CHANGED,
  UI_EVENT_APPROVALS_CHANGED,
  UI_EVENT_SNAPSHOT_CHANGED,
  UI_EVENT_TRANSACTIONS_CHANGED,
} from "../protocol/events.js";
import type { UiSnapshot } from "../protocol/schemas.js";
import { createUiRuntimeAccess } from "./access.js";

const createUiSnapshot = (chainRef: "eip155:1" | "eip155:10" = "eip155:1"): UiSnapshot => ({
  chain: {
    chainRef,
    namespace: "eip155",
    displayName: chainRef === "eip155:10" ? "Optimism" : "Ethereum",
    shortName: null,
    icon: null,
    nativeCurrency: {
      name: "Ether",
      symbol: "ETH",
      decimals: 18,
    },
  },
  chainCapabilities: {
    nativeBalance: true,
  },
  networks: {
    selectedNamespace: "eip155",
    active: chainRef,
    known: [],
    available: [],
  },
  accounts: {
    totalCount: 0,
    list: [],
    active: null,
  },
  session: {
    vaultInitialized: true,
    isUnlocked: true,
    autoLockDurationMs: 0,
    nextAutoLockAt: null,
  },
  attention: {
    queue: [],
    count: 0,
  },
  permissions: {
    origins: {},
  },
  backup: {
    pendingHdKeyringCount: 0,
    nextHdKeyring: null,
  },
});

const createUnexpectedWalletGroup = (group: string) =>
  new Proxy(
    {},
    {
      get(_target, prop) {
        if (typeof prop === "string") {
          return async () => {
            throw new Error(`Unexpected TrustedWalletApi method in ui access test: ${group}.${prop}`);
          };
        }
        return undefined;
      },
    },
  );

const createTrustedWalletStub = (snapshot: {
  get: () => UiSnapshot;
  subscribe: (listener: () => void) => () => void;
}): TrustedWalletApi =>
  ({
    snapshot: {
      get: snapshot.get,
      subscribe: snapshot.subscribe,
    },
    session: createUnexpectedWalletGroup("session"),
    onboarding: createUnexpectedWalletGroup("onboarding"),
    accounts: createUnexpectedWalletGroup("accounts"),
    networks: createUnexpectedWalletGroup("networks"),
    balances: createUnexpectedWalletGroup("balances"),
    approvals: createUnexpectedWalletGroup("approvals"),
    keyrings: createUnexpectedWalletGroup("keyrings"),
    transactions: createUnexpectedWalletGroup("transactions"),
  }) as TrustedWalletApi;

const createWalletSnapshotStub = (options: { snapshot?: UiSnapshot; listeners?: Set<() => void> } = {}) => ({
  get: vi.fn(() => options.snapshot ?? createUiSnapshot()),
  subscribe: vi.fn((listener: () => void) => {
    options.listeners?.add(listener);
    return () => {
      options.listeners?.delete(listener);
    };
  }),
});

const createUiAccess = (options: { snapshot?: ReturnType<typeof createWalletSnapshotStub> } = {}) => {
  const snapshot = options.snapshot ?? createWalletSnapshotStub();

  return createUiRuntimeAccess({
    server: {
      wallet: createTrustedWalletStub(snapshot),
      events: {
        onApprovalCreated: (handler) => {
          approvalCreatedHandlers.add(handler);
          return () => approvalCreatedHandlers.delete(handler);
        },
        onApprovalFinished: (handler) => {
          approvalFinishedHandlers.add(handler);
          return () => approvalFinishedHandlers.delete(handler);
        },
        onTransactionApprovalsChanged: (handler) => {
          transactionApprovalChangedHandlers.add(handler);
          return () => transactionApprovalChangedHandlers.delete(handler);
        },
        onTransactionsChanged: (handler) => {
          transactionChangedHandlers.add(handler);
          return () => transactionChangedHandlers.delete(handler);
        },
      },
      platform: {
        openOnboardingTab: async () => ({ activationPath: "create" }),
        openNotificationPopup: async () => ({ activationPath: "create" }),
      },
      uiOrigin: "chrome-extension://arx",
    },
  });
};

const approvalCreatedHandlers = new Set<() => void>();
const approvalFinishedHandlers = new Set<(event: { approvalId: string }) => void>();
const transactionApprovalChangedHandlers = new Set<(approvalIds: string[]) => void>();
const transactionChangedHandlers = new Set<(transactionIds: string[]) => void>();

describe("createUiRuntimeAccess", () => {
  it("uses injected wallet snapshot API for snapshot query, event, and invalidation", async () => {
    const snapshotValue = createUiSnapshot("eip155:10");
    const listeners = new Set<() => void>();
    const snapshot = createWalletSnapshotStub({ snapshot: snapshotValue, listeners });
    const access = createUiAccess({ snapshot });

    const event = access.buildSnapshotEvent();
    const dispatched = await access.dispatchRequest({
      type: "ui:request",
      id: "snapshot-1",
      method: "ui.snapshot.get",
    });
    const listener = vi.fn();
    const unsubscribe = access.subscribeStateChanged(listener);
    for (const emit of listeners) {
      emit();
    }
    unsubscribe();

    expect(event).toEqual({
      type: "ui:event",
      event: UI_EVENT_SNAPSHOT_CHANGED,
      payload: snapshotValue,
      context: {
        namespace: "eip155",
        chainRef: "eip155:10",
      },
    });
    expect(dispatched?.reply).toMatchObject({
      type: "ui:response",
      id: "snapshot-1",
      result: snapshotValue,
    });
    expect(snapshot.get).toHaveBeenCalledTimes(3);
    expect(snapshot.subscribe).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledTimes(1);
    expect(listeners.size).toBe(0);
  });

  it("emits approval invalidations from generic approval finish", () => {
    approvalCreatedHandlers.clear();
    approvalFinishedHandlers.clear();
    transactionApprovalChangedHandlers.clear();
    transactionChangedHandlers.clear();
    const access = createUiAccess();
    const events: Array<{ event: string; payload: unknown }> = [];
    const unsubscribe = access.subscribeUiEvents((event) => {
      events.push({ event: event.event, payload: event.payload });
    });

    approvalFinishedHandlers.forEach((handler) => {
      handler({ approvalId: "approval-1" });
    });

    unsubscribe();

    expect(events.filter((event) => event.event === UI_EVENT_APPROVALS_CHANGED)).toHaveLength(1);
    expect(events.filter((event) => event.event === UI_EVENT_APPROVAL_DETAIL_CHANGED)).toEqual([
      { event: UI_EVENT_APPROVAL_DETAIL_CHANGED, payload: { approvalId: "approval-1" } },
    ]);
  });

  it("emits approvals changed from transaction invalidation", () => {
    approvalCreatedHandlers.clear();
    approvalFinishedHandlers.clear();
    transactionApprovalChangedHandlers.clear();
    transactionChangedHandlers.clear();
    const access = createUiAccess();
    const events: Array<{ event: string; payload: unknown }> = [];
    const unsubscribe = access.subscribeUiEvents((event) => {
      events.push({ event: event.event, payload: event.payload });
    });

    transactionApprovalChangedHandlers.forEach((handler) => {
      handler(["approval-1"]);
    });

    unsubscribe();

    expect(events.filter((event) => event.event === UI_EVENT_APPROVALS_CHANGED)).toEqual([
      { event: UI_EVENT_APPROVALS_CHANGED, payload: { reason: "changed" } },
    ]);
    expect(events.filter((event) => event.event === UI_EVENT_APPROVAL_DETAIL_CHANGED)).toEqual([
      { event: UI_EVENT_APPROVAL_DETAIL_CHANGED, payload: { approvalId: "approval-1" } },
    ]);
  });

  it("emits transaction history invalidations from transaction lifecycle events", () => {
    approvalCreatedHandlers.clear();
    approvalFinishedHandlers.clear();
    transactionApprovalChangedHandlers.clear();
    transactionChangedHandlers.clear();
    const access = createUiAccess();
    const events: Array<{ event: string; payload: unknown }> = [];
    const unsubscribe = access.subscribeUiEvents((event) => {
      events.push({ event: event.event, payload: event.payload });
    });

    transactionChangedHandlers.forEach((handler) => {
      handler(["tx-1", "tx-1", "tx-2"]);
    });

    unsubscribe();

    expect(events.filter((event) => event.event === UI_EVENT_TRANSACTIONS_CHANGED)).toEqual([
      { event: UI_EVENT_TRANSACTIONS_CHANGED, payload: { transactionIds: ["tx-1", "tx-2"] } },
    ]);
  });
});
