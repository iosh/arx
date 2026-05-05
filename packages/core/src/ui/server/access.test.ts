import { describe, expect, it } from "vitest";
import type { UiNetworksSnapshot } from "../../services/runtime/chainViews/types.js";
import { UI_EVENT_APPROVAL_DETAIL_CHANGED, UI_EVENT_APPROVALS_CHANGED } from "../protocol/events.js";
import { createUiRuntimeAccess } from "./access.js";

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
            resolve: async () => ({ approvalId: "approval-1", status: "rejected", terminalReason: "user_reject" }),
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
        transactions: {
          beginTransactionApproval: async () =>
            ({
              transactionId: "tx-1",
              approvalId: "approval-1",
            }) as never,
          rerunPrepare: async () => {},
          applyDraftEdit: async () => {},
          onStateChanged: (handler: (change: { transactionIds: string[]; approvalIds: string[] }) => void) => {
            transactionHandlers.add(handler);
            return () => transactionHandlers.delete(handler);
          },
        },
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
const transactionHandlers = new Set<(change: { transactionIds: string[]; approvalIds: string[] }) => void>();

describe("createUiRuntimeAccess", () => {
  it("emits approval detail changed from transaction invalidation without duplicating it on approval finish", () => {
    approvalFinishedHandlers.clear();
    transactionHandlers.clear();
    const access = createUiAccess();
    const events: Array<{ event: string; payload: unknown }> = [];
    const unsubscribe = access.subscribeUiEvents((event) => {
      events.push({ event: event.event, payload: event.payload });
    });

    approvalFinishedHandlers.forEach((handler) =>
      handler({ approvalId: "approval-1", subject: { kind: "transaction", transactionId: "tx-1" } }),
    );
    transactionHandlers.forEach((handler) => handler({ transactionIds: ["tx-1"], approvalIds: ["approval-1"] }));

    unsubscribe();

    expect(events.filter((event) => event.event === UI_EVENT_APPROVALS_CHANGED)).toHaveLength(1);
    expect(events.filter((event) => event.event === UI_EVENT_APPROVAL_DETAIL_CHANGED)).toEqual([
      { event: UI_EVENT_APPROVAL_DETAIL_CHANGED, payload: { approvalId: "approval-1" } },
    ]);
  });
});
