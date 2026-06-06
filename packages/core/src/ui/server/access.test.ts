import { describe, expect, it } from "vitest";
import type { UiNetworksSnapshot } from "../../services/runtime/chainViews/types.js";
import {
  UI_EVENT_APPROVAL_DETAIL_CHANGED,
  UI_EVENT_APPROVALS_CHANGED,
  UI_EVENT_TRANSACTIONS_CHANGED,
} from "../protocol/events.js";
import { createUiRuntimeAccess } from "./access.js";
import type { UiTransactionsAccess } from "./types.js";

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

const createUiAccess = () =>
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
          onFinished: (
            handler: (event: { approvalId: string; subject?: { kind: "transaction"; transactionId: string } }) => void,
          ) => {
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
          getUnlockState: () => ({ kind: "unlocked" }),
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
      encodeError: () => ({ reason: "rpc_internal", message: "err" }) as never,
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
  });

const approvalFinishedHandlers = new Set<
  (event: { approvalId: string; subject?: { kind: "transaction"; transactionId: string } }) => void
>();
const transactionApprovalChangedHandlers = new Set<(approvalIds: string[]) => void>();
const transactionChangedHandlers = new Set<(transactionIds: string[]) => void>();

describe("createUiRuntimeAccess", () => {
  it("emits approval detail changed from transaction invalidation without duplicating it on approval finish", () => {
    approvalFinishedHandlers.clear();
    transactionApprovalChangedHandlers.clear();
    transactionChangedHandlers.clear();
    const access = createUiAccess();
    const events: Array<{ event: string; payload: unknown }> = [];
    const unsubscribe = access.subscribeUiEvents((event) => {
      events.push({ event: event.event, payload: event.payload });
    });

    approvalFinishedHandlers.forEach((handler) => {
      handler({ approvalId: "approval-1", subject: { kind: "transaction", transactionId: "tx-1" } });
    });
    transactionApprovalChangedHandlers.forEach((handler) => {
      handler(["approval-1"]);
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
