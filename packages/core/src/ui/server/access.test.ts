import { describe, expect, it, vi } from "vitest";
import type { UiNetworksSnapshot } from "../../services/runtime/chainViews/types.js";
import {
  UI_EVENT_APPROVAL_DETAIL_CHANGED,
  UI_EVENT_APPROVALS_CHANGED,
  UI_EVENT_SNAPSHOT_CHANGED,
  UI_EVENT_TRANSACTIONS_CHANGED,
} from "../protocol/events.js";
import type { UiSnapshot } from "../protocol/schemas.js";
import { createUiRuntimeAccess } from "./access.js";
import type { UiTransactionsAccess, UiWalletSnapshotReadModel } from "./types.js";

const createTransactionAccess = () =>
  ({
    requestTransactionApproval: async () => {
      throw new Error("not used");
    },
    rerunApprovalPrepare: async () => {
      throw new Error("not used");
    },
    updateApprovalDraft: async () => {
      throw new Error("not used");
    },
    approveAndSubmitTransaction: async () => {
      throw new Error("not used");
    },
    rejectTransactionApproval: async () => {
      throw new Error("not used");
    },
    getTransactionApproval: () => null,
    getTransactionApprovalByTransactionId: () => null,
    getTransaction: async () => null,
    listTransactions: async () => [],
    onTransactionsChanged: (handler: (transactionIds: string[]) => void) => {
      transactionChangedHandlers.add(handler);
      return () => transactionChangedHandlers.delete(handler);
    },
    onTransactionApprovalsChanged: (handler: (approvalIds: string[]) => void) => {
      transactionApprovalChangedHandlers.add(handler);
      return () => transactionApprovalChangedHandlers.delete(handler);
    },
  }) satisfies UiTransactionsAccess;

const createUiSnapshot = (chainRef: "eip155:1" | "eip155:10" = "eip155:1"): UiSnapshot => ({
  chain: {
    chainRef,
    chainId: chainRef === "eip155:10" ? "0xa" : "0x1",
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
    sendTransaction: true,
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
  vault: {
    initialized: true,
  },
});

const createUiAccess = (options: { read?: UiWalletSnapshotReadModel } = {}) =>
  createUiRuntimeAccess({
    server: {
      access: {
        accounts: {
          getState: () => ({ namespaces: {}, updatedAt: 0 }),
          listOwnedForNamespace: () => [],
          getActiveAccountForNamespace: () => null,
          setActiveAccount: async () => {},
        },
        approvals: {
          read: {
            listPendingEntries: () => [],
            getDetail: () => null,
          },
          write: {
            resolve: async () => ({ status: "resolved" }),
          },
        },
        approvalEvents: {
          onCreated: () => () => {},
          onFinished: (handler: (event: { approvalId: string }) => void) => {
            approvalFinishedHandlers.add(handler);
            return () => approvalFinishedHandlers.delete(handler);
          },
        },
        permissions: {
          buildUiPermissionsSnapshot: () => ({ origins: [] }),
        },
        transactions: createTransactionAccess(),
        chains: {
          selectWalletChain: async () => {},
          buildWalletNetworksSnapshot: () =>
            ({
              selectedNamespace: "eip155",
              active: "eip155:1",
              known: [],
              available: [],
            }) satisfies UiNetworksSnapshot,
          findAvailableChainView: () => null,
          getApprovalReviewChainView: () => ({ namespace: "eip155", chainRef: "eip155:1" }),
          getActiveChainViewForNamespace: () => ({ namespace: "eip155", chainRef: "eip155:1" }),
          getSelectedNamespace: () => "eip155",
          getSelectedChainView: () => ({ namespace: "eip155", chainRef: "eip155:1" }),
          requireAvailableChainMetadata: () => ({
            namespace: "eip155",
            chainRef: "eip155:1",
            displayName: "Ethereum",
            rpcEndpoints: [],
          }),
        },
        accountCodecs: {
          get: () => null as never,
          toAccountKeyFromAddress: () => "account-key",
        },
        session: {
          getStatus: () => ({ initialized: true, isUnlocked: true, isLocked: false, unlockReason: null }),
          getSessionLockState: () => ({
            status: "unlocked",
            unlockedAt: 1,
            autoLockDurationMs: 900_000,
            nextAutoLockAt: 900_001,
          }),
          isUnlocked: () => true,
          hasInitializedVault: () => true,
          onStateChanged: () => () => {},
        } as never,
        walletSetup: {
          getState: () => ({ totalAccountCount: 0, hasOwnedAccounts: false }),
        } as never,
        keyrings: {
          list: async () => [],
          exportMnemonic: async () => "",
          exportPrivateKeyByAccountKey: async () => "",
        } as never,
        attention: {
          getSnapshot: () => ({ queue: [], count: 0 }),
        },
        namespaceBindings: {
          getUi: () => null,
          hasTransaction: () => false,
          hasTransactionReceiptTracking: () => false,
        },
      },
      platform: {
        openOnboardingTab: async () => ({ activationPath: "create" }),
        openNotificationPopup: async () => ({ activationPath: "create" }),
      },
      uiOrigin: "chrome-extension://arx",
    },
    bridge: {
      persistVaultMeta: async () => {},
      stateChanged: {
        accounts: { onStateChanged: () => () => {} },
        permissions: { onStateChanged: () => () => {} },
        chains: {
          onStateChanged: () => () => {},
          onSelectionChanged: () => () => {},
        },
        session: { onStateChanged: () => () => {} },
        attention: { onStateChanged: () => () => {} },
      },
    },
    ...(options.read ? { read: options.read } : {}),
  });

const approvalFinishedHandlers = new Set<(event: { approvalId: string }) => void>();
const transactionApprovalChangedHandlers = new Set<(approvalIds: string[]) => void>();
const transactionChangedHandlers = new Set<(transactionIds: string[]) => void>();

describe("createUiRuntimeAccess", () => {
  it("uses injected wallet read model for snapshot query, event, and invalidation", async () => {
    const snapshot = createUiSnapshot("eip155:10");
    const listeners = new Set<() => void>();
    const read = {
      getWalletSnapshot: vi.fn(() => snapshot),
      subscribe: vi.fn((listener: () => void) => {
        listeners.add(listener);
        return () => {
          listeners.delete(listener);
        };
      }),
    } satisfies UiWalletSnapshotReadModel;
    const access = createUiAccess({ read });

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
      payload: snapshot,
      context: {
        namespace: "eip155",
        chainRef: "eip155:10",
      },
    });
    expect(dispatched?.reply).toMatchObject({
      type: "ui:response",
      id: "snapshot-1",
      result: snapshot,
    });
    expect(read.getWalletSnapshot).toHaveBeenCalledTimes(2);
    expect(read.subscribe).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledTimes(1);
    expect(listeners.size).toBe(0);
  });

  it("emits approval invalidations from generic approval finish", () => {
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
