import { describe, expect, it } from "vitest";
import type { TrustedWalletApi } from "../../wallet/api.js";
import {
  UI_EVENT_APPROVAL_DETAIL_CHANGED,
  UI_EVENT_APPROVALS_CHANGED,
  UI_EVENT_SESSION_CHANGED,
  UI_EVENT_TRANSACTIONS_CHANGED,
} from "../protocol/events.js";
import { createUiRuntimeAccess } from "./access.js";

const createChainView = (chainRef: "eip155:1" | "eip155:10" = "eip155:1") => ({
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

const createTrustedWalletStub = (options: { chain?: ReturnType<typeof createChainView> } = {}): TrustedWalletApi =>
  ({
    networks: {
      getSelectedChain: () => options.chain ?? createChainView(),
    },
    session: createUnexpectedWalletGroup("session"),
    setup: createUnexpectedWalletGroup("setup"),
    accounts: createUnexpectedWalletGroup("accounts"),
    balances: createUnexpectedWalletGroup("balances"),
    approvals: createUnexpectedWalletGroup("approvals"),
    keyrings: createUnexpectedWalletGroup("keyrings"),
    transactions: createUnexpectedWalletGroup("transactions"),
  }) as TrustedWalletApi;

const createUiAccess = (options: { chain?: ReturnType<typeof createChainView> } = {}) => {
  return createUiRuntimeAccess({
    server: {
      wallet: createTrustedWalletStub(options),
      events: {
        onSessionChanged: (handler) => {
          sessionChangedHandlers.add(handler);
          return () => sessionChangedHandlers.delete(handler);
        },
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

const sessionChangedHandlers = new Set<() => void>();
const approvalCreatedHandlers = new Set<() => void>();
const approvalFinishedHandlers = new Set<(event: { approvalId: string }) => void>();
const transactionApprovalChangedHandlers = new Set<(approvalIds: string[]) => void>();
const transactionChangedHandlers = new Set<(transactionIds: string[]) => void>();

describe("createUiRuntimeAccess", () => {
  it("emits session invalidation from session state changes", () => {
    sessionChangedHandlers.clear();
    const access = createUiAccess({
      chain: {
        get chainRef(): "eip155:1" {
          throw new Error("selected chain should not be read for ui invalidation events");
        },
        namespace: "eip155",
        displayName: "Ethereum",
        shortName: null,
        icon: null,
        nativeCurrency: {
          name: "Ether",
          symbol: "ETH",
          decimals: 18,
        },
      },
    });
    const events: Array<{ event: string; payload: unknown }> = [];
    const unsubscribe = access.subscribeUiEvents((event) => {
      events.push({ event: event.event, payload: event.payload });
    });

    for (const handler of sessionChangedHandlers) {
      handler();
    }

    unsubscribe();

    expect(events).toEqual([{ event: UI_EVENT_SESSION_CHANGED, payload: { reason: "changed" } }]);
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
